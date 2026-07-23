package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// FrontendTool is a tool that runs in the browser instead of on the
// server. When the LLM decides to call one, we emit a `tool.call`
// event with `is_frontend:true` over the SSE stream, then BLOCK
// waiting for the browser to POST the result back to
// `/sessions/{id}/tool`.
//
// Use cases: UI affordances (chart rendering, color schemes, focus
// modes), client-side state mutations (open modal, scroll to
// element), or environment probes (window size, theme, locale).
//
// Implements `core.Tool` so it plugs into the wider agent engine.
type FrontendTool struct {
	name        string
	description string
	inputSchema map[string]interface{}
	timeout     time.Duration

	mu      sync.Mutex
	pending map[string]chan pendingResult // call_id -> result
}

type pendingResult struct {
	Result json.RawMessage
	Err    string
}

// NewFrontendTool creates a new frontend tool.
func NewFrontendTool(name, description string, inputSchema map[string]interface{}) *FrontendTool {
	return &FrontendTool{
		name:        name,
		description: description,
		inputSchema: inputSchema,
		timeout:     60 * time.Second,
		pending:     make(map[string]chan pendingResult),
	}
}

func (t *FrontendTool) SetTimeout(d time.Duration) { t.timeout = d }

// Name implements core.Tool.
func (t *FrontendTool) Name() string { return t.name }

// Description implements core.Tool.
func (t *FrontendTool) Description() string { return t.description }

// Schema implements core.Tool.
func (t *FrontendTool) Schema() map[string]interface{} {
	if t.inputSchema == nil {
		return map[string]interface{}{"type": "object"}
	}
	return t.inputSchema
}

// IsFrontend marks this tool as a frontend tool — the orchestrator
// looks for this when emitting tool.call events.
func (t *FrontendTool) IsFrontend() bool { return true }

// Call blocks waiting for the browser to POST the result for
// `callID`. Used by the orchestrator's frontend-tool step.
func (t *FrontendTool) Await(callID string) (json.RawMessage, string, error) {
	t.mu.Lock()
	ch := t.pending[callID]
	t.mu.Unlock()
	if ch == nil {
		return nil, "", fmt.Errorf("no pending call for id %s", callID)
	}
	select {
	case pr := <-ch:
		return pr.Result, pr.Err, nil
	case <-time.After(t.timeout):
		return nil, "", fmt.Errorf("frontend tool %q timed out after %s", t.name, t.timeout)
	}
}

// RegisterCall creates a pending slot for `callID` and returns the
// channel the orchestrator will await on.
func (t *FrontendTool) RegisterCall(callID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pending[callID] = make(chan pendingResult, 1)
}

// DeliverResult is called from the HTTP handler when the browser
// POSTs the tool result.
func (t *FrontendTool) DeliverResult(callID string, result json.RawMessage, errStr string) {
	t.mu.Lock()
	ch, ok := t.pending[callID]
	t.mu.Unlock()
	if !ok {
		return // unknown / already delivered / timed out
	}
	select {
	case ch <- pendingResult{Result: result, Err: errStr}:
	default:
		// channel full or closed
	}
}

// MakeCallID returns a fresh UUID for tracking a frontend tool call.
func MakeCallID() string { return uuid.NewString() }

// Compile-time interface check (matches core.Tool shape).
var _ interface {
	Name() string
	Description() string
	Schema() map[string]interface{}
} = (*FrontendTool)(nil)

// silence unused import warning when this file is the only consumer
var _ = context.Background