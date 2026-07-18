package core

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// PendingResult is what the frontend sends back to DeliverResult.
type PendingResult struct {
	Result interface{}
	Err    error
}

// FrontendTool is a Tool whose Execute sends a tool_call event to the
// client (over the same channel the agent is streaming on) and waits
// for the matching tool_result event back.
//
// This eliminates the need for MCP for UI-bound tools. The agent
// doesn't know or care whether the tool runs locally (calculator) or
// in the browser (render_chart). Same Tool interface, same call site.
//
// Usage:
//
//     sub := sess.Stream("frontend")
//     chart := NewFrontendTool("render_chart", "Render a chart in the UI", sub)
//     a := core.New(core.WithTools(chart, ...))
//
// The frontend listens on the same stream. When it sees a tool.call
// for "render_chart", it renders and sends a tool.result back via
// session.DeliverToolResult(callID, result, err).
type FrontendTool struct {
	name        string
	description string
	schema      map[string]interface{}
	stream      *Sub
	timeout     time.Duration

	mu      sync.Mutex
	pending map[string]chan PendingResult // call_id -> result
}

// NewFrontendTool creates a tool that delegates execution to the frontend.
func NewFrontendTool(name, description string, stream *Sub) *FrontendTool {
	return &FrontendTool{
		name:        name,
		description: description,
		stream:      stream,
		timeout:     60 * time.Second,
		pending:     make(map[string]chan PendingResult),
	}
}

// SetSchema sets the JSON schema for the tool's args.
func (t *FrontendTool) SetSchema(s map[string]interface{}) { t.schema = s }

// SetTimeout sets the maximum time to wait for a frontend result.
func (t *FrontendTool) SetTimeout(d time.Duration) { t.timeout = d }

// Name returns the tool name.
func (t *FrontendTool) Name() string { return t.name }

// Description returns the tool description (shown to the LLM).
func (t *FrontendTool) Description() string { return t.description }

// Schema returns the JSON schema.
func (t *FrontendTool) Schema() map[string]interface{} {
	if t.schema == nil {
		return map[string]interface{}{"type": "object"}
	}
	return t.schema
}

// Execute sends a tool_call to the frontend and waits for the result.
// Returns an error if:
//   - The session stream is closed
//   - The frontend doesn't respond within the timeout
//   - The frontend returns an error
func (t *FrontendTool) Execute(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	callID := uuid.New().String()
	resultCh := make(chan PendingResult, 1)

	t.mu.Lock()
	t.pending[callID] = resultCh
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.pending, callID)
		t.mu.Unlock()
	}()

	// Send the call to the frontend via the same event stream
	callEvent := Event{
		Type: EventToolCall,
		Payload: map[string]interface{}{
			"id":         callID,
			"name":       t.name,
			"input":      args,
			"is_frontend": true, // hint to clients
		},
	}
	select {
	case t.stream.Ch <- callEvent:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(t.timeout):
		return nil, &ToolTimeoutError{Tool: t.name, Timeout: t.timeout}
	}

	// Wait for the result
	waitCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()

	select {
	case pr := <-resultCh:
		if pr.Err != nil {
			return nil, pr.Err
		}
		return pr.Result, nil
	case <-waitCtx.Done():
		return nil, &ToolTimeoutError{Tool: t.name, Timeout: t.timeout}
	}
}

// DeliverResult is called by the session when a tool.result event
// comes in from the frontend. It routes the result to the waiting
// Execute call. Safe to call from any goroutine.
func (t *FrontendTool) DeliverResult(callID string, result interface{}, err error) {
	t.mu.Lock()
	ch, ok := t.pending[callID]
	t.mu.Unlock()
	if !ok {
		return
	}
	pr := PendingResult{Result: result, Err: err}
	select {
	case ch <- pr:
	default:
		// channel full or closed, drop
	}
}

// ToolTimeoutError is returned when the frontend doesn't respond in time.
type ToolTimeoutError struct {
	Tool    string
	Timeout time.Duration
}

func (e *ToolTimeoutError) Error() string {
	return "frontend tool " + e.Tool + " timed out after " + e.Timeout.String()
}

// IsTimeout is a convenience for errors.Is checks.
func (e *ToolTimeoutError) Is(target error) bool {
	return target == ErrToolTimeout
}

// ErrToolTimeout is a sentinel for the errors.Is check.
var ErrToolTimeout = errors.New("frontend tool timeout")

// Compile-time check
var _ Tool = (*FrontendTool)(nil)
