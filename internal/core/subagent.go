package core

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/google/uuid"
)

// InProcessSubAgentCoord runs sub-agents as goroutines on the same
// engine. The sub-agent's events flow into the parent's stream with
// parent_step metadata, so a single SSE consumer sees the full hierarchy.
//
// This is the default. For distributed deployments, swap in a gRPC
// or HTTP client that calls Run() on a remote engine.
type InProcessSubAgentCoord struct {
	agent  *Agent
	mu     sync.Mutex
	active map[string]*subAgentRun // keyed by handle.ID().String()
}

// SubAgentHandle is the handle for a running sub-agent.
type SubAgentHandle interface {
	ID() string
	Cancel()
}

// SubAgentResult is the result of a sub-agent run.
type SubAgentResult struct {
	Handle SubAgentHandle
	Output string
	Err    error
}

// SubAgentCoord handles dispatching tasks to sub-agents. Sub-agent
// events are emitted in the same stream as the parent, with
// parent_step metadata for hierarchical display.
type SubAgentCoord interface {
	Dispatch(ctx context.Context, sess *Session, role string, task string) (SubAgentHandle, error)
	Await(ctx context.Context, h SubAgentHandle) (SubAgentResult, error)
}

type subAgentRun struct {
	id     string
	cancel context.CancelFunc
	done   chan SubAgentResult
}

var subAgentCounter atomic.Uint64

// newSubAgentID returns a unique id for a sub-agent.
func newSubAgentID() string {
	n := subAgentCounter.Add(1)
	return fmt.Sprintf("sub-%d-%s", n, uuid.NewString()[:8])
}

// inProcessHandle is the handle for a running sub-agent.
type inProcessHandle struct {
	id     string
	cancel context.CancelFunc
	done   chan SubAgentResult
}

func (h *inProcessHandle) ID() string { return h.id }
func (h *inProcessHandle) Cancel()      { h.cancel() }

// NewInProcessSubAgentCoord creates a coord that runs sub-agents
// in-process. Pass the parent's agent so sub-agents share its
// LLM router, tools, and stores.
func NewInProcessSubAgentCoord(agent *Agent) *InProcessSubAgentCoord {
	return &InProcessSubAgentCoord{
		agent:  agent,
		active: make(map[string]*subAgentRun),
	}
}

// Dispatch spawns a sub-agent. Returns a handle. The sub-agent's
// events are emitted in the parent's stream with parent_step set
// and the "subagent.*" action tag in the payload so consumers can
// distinguish them.
func (c *InProcessSubAgentCoord) Dispatch(ctx context.Context, sess *Session, role, task string) (SubAgentHandle, error) {
	subID := newSubAgentID()
	subCtx, cancel := context.WithCancel(ctx)

	// Emit sub-agent start in parent stream — SYNCHRONOUS so live
	// subscribers see the event before the sub-agent starts working.
	sess.emit(Event{
		Type: EventSubagent,
		Payload: map[string]interface{}{
			"action":      "start",
			"sub_id":      subID,
			"role":        role,
			"task":        task,
			"parent_step": sess.State.Step,
		},
	})

	done := make(chan SubAgentResult, 1)
	run := &subAgentRun{
		id:     subID,
		cancel: cancel,
		done:   done,
	}
	c.mu.Lock()
	c.active[subID] = run
	c.mu.Unlock()

	handle := &inProcessHandle{id: subID, cancel: cancel, done: done}

	// Spawn the sub-agent's loop. We don't share the parent's session
	// state (the sub-agent gets its own scratchpad, history, plan) but
	// the sub-agent's events are emitted into the parent's stream via
	// the parent step. This is the "sub-agents in the same stream"
	// claim that was previously aspirational.
	go func() {
		defer func() {
			c.mu.Lock()
			delete(c.active, subID)
			c.mu.Unlock()
		}()

		// Build a sub-agent session
		sub, err := c.agent.newSession(subCtx, fmt.Sprintf("[%s] %s", role, task))
		if err != nil {
			done <- SubAgentResult{Handle: handle, Err: err}
			sess.emit(Event{
				Type: EventSubagent,
				Payload: map[string]interface{}{
					"action":      "error",
					"sub_id":      subID,
					"error":       err.Error(),
					"parent_step": sess.State.Step,
				},
			})
			return
		}

		// Forward sub-agent events into the parent stream with parent_step
		subSub := sub.Stream("forwarder-" + subID)
		go func() {
			for e := range subSub.Channel() {
				// Re-emit in the parent stream with parent_step metadata
				if e.Payload == nil {
					e.Payload = map[string]interface{}{}
				}
				e.Payload["sub_id"] = subID
				e.Payload["role"] = role
				e.Payload["parent_step"] = sess.State.Step
				sess.emit(e)
			}
		}()

		// Run the sub-agent's loop
		sub.loop()

		// After loop exits, emit done marker
		sess.emit(Event{
			Type: EventSubagent,
			Payload: map[string]interface{}{
				"action":      "done",
				"sub_id":      subID,
				"parent_step": sess.State.Step,
			},
		})

		done <- SubAgentResult{Handle: handle, Output: "sub-agent completed"}
	}()

	return handle, nil
}

// Await blocks for the sub-agent to finish.
func (c *InProcessSubAgentCoord) Await(ctx context.Context, h SubAgentHandle) (SubAgentResult, error) {
	ip, ok := h.(*inProcessHandle)
	if !ok {
		return SubAgentResult{Handle: h, Err: fmt.Errorf("unknown handle type")}, nil
	}
	select {
	case r := <-ip.done:
		return r, nil
	case <-ctx.Done():
		return SubAgentResult{Handle: h, Err: ctx.Err()}, ctx.Err()
	}
}

// InFlight returns the number of sub-agents currently running.
func (c *InProcessSubAgentCoord) InFlight() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.active)
}

// sync import alias
var _ = (chan struct{})(nil)

// Compile-time check
var _ SubAgentCoord = (*InProcessSubAgentCoord)(nil)
