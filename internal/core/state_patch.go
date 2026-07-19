// State compression + bidirectional sync.
//
// The full ThreadState can be 100KB+. We don't ship the whole thing
// over the wire every time it changes. Instead we ship diffs.
//
// Format: a sequence of operations on a JSON document:
//   {op: "set", path: "/plan/2/status", value: "done"}
//   {op: "del", path: "/scratchpad/foo"}
//   {op: "add", path: "/plan/-", value: {...}}
//
// This is a subset of RFC 6902 (JSON Patch) — the operations we
// actually use. It's small enough that a 100KB state changes to
// a 200-byte patch for typical edits.

package core

import (
	"encoding/json"
	"fmt"
	"reflect"
)

// StateOp is a single state mutation.
type StateOp struct {
	Op    string      `json:"op"`              // set | add | del | inc
	Path  string      `json:"path"`            // /field or /array/0
	Value interface{} `json:"value,omitempty"` // for set/add/inc
}

// StatePatch is a list of operations to apply atomically.
type StatePatch struct {
	Ops   []StateOp `json:"ops"`
	From  string    `json:"from,omitempty"`  // optional base version
	To    string    `json:"to,omitempty"`    // new version after patch
}

// ApplyStatePatch applies the patch to a copy of state, returns the new state.
// Errors are returned per-op so the client can retry individual ops.
func ApplyStatePatch(state ThreadState, patch StatePatch) (ThreadState, error) {
	for i, op := range patch.Ops {
		var err error
		state, err = applyOp(state, op)
		if err != nil {
			return state, fmt.Errorf("op %d (%s %s): %w", i, op.Op, op.Path, err)
		}
	}
	return state, nil
}

// ComputeStatePatch returns a minimal patch that transforms from -> to.
// Currently produces a single "set" op per top-level field that differs.
// Can be made smarter (recursive diff) but this is correct and small.
func ComputeStatePatch(from, to ThreadState) StatePatch {
	var ops []StateOp
	// Plan: replace entirely (plans are usually small)
	if !planEqual(from.Plan, to.Plan) {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/plan",
			Value: to.Plan,
		})
	}
	// Scratchpad: replace entirely (small map)
	if !mapEqual(from.Scratchpad, to.Scratchpad) {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/scratchpad",
			Value: to.Scratchpad,
		})
	}
	// Scalar fields
	if from.LastObservation != to.LastObservation {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/last_observation",
			Value: to.LastObservation,
		})
	}
	if from.Status != to.Status {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/status",
			Value: to.Status,
		})
	}
	if from.CurrentStep != to.CurrentStep {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/current_step",
			Value: to.CurrentStep,
		})
	}
	if from.TokensUsed != to.TokensUsed {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/tokens_used",
			Value: to.TokensUsed,
		})
	}
	if from.CostUSD != to.CostUSD {
		ops = append(ops, StateOp{
			Op:    "set",
			Path:  "/cost_usd",
			Value: to.CostUSD,
		})
	}
	return StatePatch{Ops: ops}
}

func applyOp(state ThreadState, op StateOp) (ThreadState, error) {
	switch op.Op {
	case "set":
		return setPath(state, op.Path, op.Value)
	case "add":
		return setPath(state, op.Path, op.Value)
	case "del":
		return delPath(state, op.Path)
	case "inc":
		return incPath(state, op.Path, op.Value)
	default:
		return state, fmt.Errorf("unknown op: %s", op.Op)
	}
}

// Supported paths:
//   /plan                   replace whole plan
//   /plan/0                 replace plan[0]
//   /scratchpad             replace whole map
//   /scratchpad/foo         replace scratchpad["foo"]
//   /last_observation
//   /status
//   /current_step
//   /tokens_used
//   /cost_usd
//
// For arrays (plan), /plan/N replaces element N.
// /plan/- appends.

func setPath(state ThreadState, path string, value interface{}) (ThreadState, error) {
	switch path {
	case "/plan":
		plan, ok := value.([]interface{})
		if !ok {
			return state, fmt.Errorf("plan must be array")
		}
		newPlan := make([]PlanStep, len(plan))
		for i, p := range plan {
			b, _ := json.Marshal(p)
			var ps PlanStep
			if err := json.Unmarshal(b, &ps); err != nil {
				return state, fmt.Errorf("plan[%d]: %w", i, err)
			}
			newPlan[i] = ps
		}
		state.Plan = newPlan
		return state, nil
	case "/scratchpad":
		m, ok := value.(map[string]interface{})
		if !ok {
			return state, fmt.Errorf("scratchpad must be object")
		}
		state.Scratchpad = m
		return state, nil
	case "/last_observation":
		state.LastObservation = value
		return state, nil
	case "/status":
		s, ok := value.(string)
		if !ok {
			return state, fmt.Errorf("status must be string")
		}
		state.Status = s
		return state, nil
	case "/current_step":
		if v, ok := value.(float64); ok {
			state.CurrentStep = int(v)
		}
		return state, nil
	case "/tokens_used":
		if v, ok := value.(float64); ok {
			state.TokensUsed = int(v)
		}
		return state, nil
	case "/cost_usd":
		if v, ok := value.(float64); ok {
			state.CostUSD = v
		}
		return state, nil
	}
	// /plan/N or /plan/-
	if len(path) > 5 && path[:6] == "/plan/" {
		idxStr := path[6:]
		if idxStr == "-" {
			// append
			b, _ := json.Marshal(value)
			var ps PlanStep
			if err := json.Unmarshal(b, &ps); err != nil {
				return state, err
			}
			state.Plan = append(state.Plan, ps)
			return state, nil
		}
		// N
		var idx int
		if _, err := fmt.Sscanf(idxStr, "%d", &idx); err != nil {
			return state, fmt.Errorf("invalid plan index: %s", idxStr)
		}
		if idx < 0 || idx >= len(state.Plan) {
			return state, fmt.Errorf("plan index out of range: %d", idx)
		}
		b, _ := json.Marshal(value)
		var ps PlanStep
		if err := json.Unmarshal(b, &ps); err != nil {
			return state, err
		}
		state.Plan[idx] = ps
		return state, nil
	}
	// /scratchpad/key
	if len(path) > 12 && path[:13] == "/scratchpad/" {
		key := path[13:]
		if state.Scratchpad == nil {
			state.Scratchpad = make(map[string]interface{})
		}
		state.Scratchpad[key] = value
		return state, nil
	}
	return state, fmt.Errorf("unknown path: %s", path)
}

func delPath(state ThreadState, path string) (ThreadState, error) {
	if len(path) > 12 && path[:13] == "/scratchpad/" {
		key := path[13:]
		delete(state.Scratchpad, key)
		return state, nil
	}
	if len(path) > 5 && path[:6] == "/plan/" {
		idxStr := path[6:]
		var idx int
		if _, err := fmt.Sscanf(idxStr, "%d", &idx); err != nil {
			return state, err
		}
		if idx < 0 || idx >= len(state.Plan) {
			return state, fmt.Errorf("plan index out of range: %d", idx)
		}
		state.Plan = append(state.Plan[:idx], state.Plan[idx+1:]...)
		return state, nil
	}
	return state, fmt.Errorf("cannot delete path: %s", path)
}

func incPath(state ThreadState, path string, value interface{}) (ThreadState, error) {
	delta, ok := value.(float64)
	if !ok {
		return state, fmt.Errorf("inc value must be number")
	}
	switch path {
	case "/current_step":
		state.CurrentStep += int(delta)
	case "/tokens_used":
		state.TokensUsed += int(delta)
	case "/cost_usd":
		state.CostUSD += delta
	default:
		return state, fmt.Errorf("cannot inc path: %s", path)
	}
	return state, nil
}

func planEqual(a, b []PlanStep) bool {
	return reflect.DeepEqual(a, b)
}

func mapEqual(a, b map[string]interface{}) bool {
	return reflect.DeepEqual(a, b)
}
