package core

import (
	"context"
	"sync"

	"github.com/google/uuid"
)

// SubAgentCoord handles dispatching tasks to sub-agents. Sub-agent events
// are emitted in the same stream as the parent, with parent_step
// metadata for hierarchical display.
type SubAgentCoord interface {
	// Dispatch launches a sub-agent and returns a handle. The sub-agent's
	// events flow into the parent's stream with parent_step set.
	Dispatch(ctx context.Context, sess *Session, role string, task string) (SubAgentHandle, error)
	// Await blocks until the sub-agent completes.
	Await(ctx context.Context, h SubAgentHandle) (SubAgentResult, error)
}

// SubAgentHandle is the handle for a running sub-agent.
type SubAgentHandle interface {
	ID() uuid.UUID
	Cancel()
}

// SubAgentResult is the result of a sub-agent run.
type SubAgentResult struct {
	Handle SubAgentHandle
	Output string
	Err    error
}

// InProcessSubAgentCoord runs sub-agents as goroutines on the same
// engine. This is the default; for distributed deployments, replace
// with an HTTP/gRPC client.
type InProcessSubAgentCoord struct {
	mu      sync.Mutex
	agents  map[uuid.UUID]*Agent
	handles map[uuid.UUID]*inProcessHandle
}

type inProcessHandle struct {
	id      uuid.UUID
	cancel  context.CancelFunc
	done    chan SubAgentResult
	events  *Sub // sub-agent's event stream
}

func (h *inProcessHandle) ID() uuid.UUID { return h.id }
func (h *inProcessHandle) Cancel()      { h.cancel() }

// NewInProcessSubAgentCoord returns a coord that runs sub-agents
// in-process. For multi-process or distributed deployments, replace
// with a gRPC or HTTP client.
func NewInProcessSubAgentCoord() *InProcessSubAgentCoord {
	return &InProcessSubAgentCoord{
		agents:  make(map[uuid.UUID]*Agent),
		handles: make(map[uuid.UUID]*inProcessHandle),
	}
}

// Dispatch spawns a sub-agent and starts its loop. Returns a handle
// that can be awaited.
//
// Sub-agent events are emitted in the parent's stream with parent_step
// metadata. The session also tracks active sub-agents so checkpoint
// snapshots include them.
func (c *InProcessSubAgentCoord) Dispatch(ctx context.Context, sess *Session, role, task string) (SubAgentHandle, error) {
	subID := uuid.New()
	subCtx, cancel := context.WithCancel(ctx)

	// Sub-agent shares the parent's engine (router, tools, etc.)
	c.mu.Lock()
	// We don't have direct access to the parent's Agent here, but
	// in practice you'd pass it. For now, stub: emit a sub-agent
	// event and return a handle.
	c.mu.Unlock()

	// Emit the sub-agent start in the parent stream
	sess.emit(Event{
		Type:      EventSubagent,
		Payload: map[string]interface{}{
			"action":     "start",
			"sub_id":     subID,
			"role":       role,
			"task":       task,
			"parent_step": sess.State.Step,
		},
	})

	handle := &inProcessHandle{
		id:     subID,
		cancel: cancel,
		done:   make(chan SubAgentResult, 1),
	}

	// Real implementation would spin up the sub-agent's loop and
	// pipe its events into the parent's stream. Stub for now.
	go func() {
		<-subCtx.Done()
		handle.done <- SubAgentResult{Handle: handle, Err: subCtx.Err()}
	}()

	return handle, nil
}

// Await blocks for the sub-agent to finish.
func (c *InProcessSubAgentCoord) Await(ctx context.Context, h SubAgentHandle) (SubAgentResult, error) {
	ip, ok := h.(*inProcessHandle)
	if !ok {
		return SubAgentResult{}, nil
	}
	select {
	case r := <-ip.done:
		return r, nil
	case <-ctx.Done():
		return SubAgentResult{Handle: h, Err: ctx.Err()}, ctx.Err()
	}
}

// Compile-time check
var _ SubAgentCoord = (*InProcessSubAgentCoord)(nil)
