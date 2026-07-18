package core

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// EventStore is the append-only log. Source of truth for resume.
//
// Every event the agent emits goes here. The session is recoverable as long
// as the EventStore is intact. Postgres in production, anything durable works.
type EventStore interface {
	Append(ctx context.Context, e Event) (assignedID int64, err error)
	Since(ctx context.Context, sessionID uuid.UUID, afterEventID int64, limit int) ([]Event, error)
	GetByID(ctx context.Context, sessionID uuid.UUID, eventID int64) (Event, error)
	Stream(ctx context.Context, sessionID uuid.UUID, afterEventID int64) (<-chan Event, error)
}

// CheckpointStore is the agent state snapshot. Loaded on resume.
//
// Frequency: every N steps (default 5). Smaller = faster resume, more writes.
// Bigger = fewer writes, longer recovery. The right answer depends on how
// long each step takes. For LLM-heavy agents, 5 is the sweet spot.
type CheckpointStore interface {
	Save(ctx context.Context, state State) error
	Load(ctx context.Context, sessionID uuid.UUID) (State, error)
	Latest(ctx context.Context, sessionID uuid.UUID) (State, error)
}

// IdempotencyStore caches tool results so replay is safe.
//
// Key: hash(session_id + tool_name + args). When the agent resumes and
// re-decides to call the same tool with the same args, the cached result
// is returned without re-executing. Critical for "do thing" actions like
// "send email" or "create issue".
type IdempotencyStore interface {
	Get(ctx context.Context, key string) (ToolResultRecord, bool, error)
	Put(ctx context.Context, key string, rec ToolResultRecord, ttl time.Duration) error
}

type ToolResultRecord struct {
	Key      string          `json:"key"`
	Result   json.RawMessage `json:"result"`
	Err      string          `json:"err,omitempty"`
	StoredAt time.Time       `json:"stored_at"`
}

// newSession creates a session row, persists initial state. Does NOT emit
// session.start — that's the caller's job (after subscribing), so the
// event isn't lost to a slow subscriber.
func (a *Agent) newSession(ctx context.Context, task string) (*Session, error) {
	id := uuid.New()
	writer := NewAsyncEventWriter(a.store, 4096)
	sess := &Session{
		State: State{
			SessionID:  id,
			Step:       0,
			Plan:       []PlanStep{},
			Scratchpad: map[string]interface{}{"task": task},
			History:    []Message{{Role: "user", Content: task}},
			UpdatedAt:  time.Now(),
		},
		cfg:    a.cfg,
		subs:   make(map[*Sub]struct{}),
		ctx:    ctx,
		cancel: func() {},
		store:  a.store,
		cp:     a.cp,
		cache:  a.cache,
		router: a.router,
		tools:  a.tools,
		ctxMgr: NewContextManager(a.cfg.ContextMaxTokens),
		writer: writer,
		onSlowSubscriber: func(sub *Sub, e Event) {
			// Stub: real impl would emit a metric, alert, or log
			// when drops exceed a threshold per sub per minute.
		},
		done: make(chan struct{}),
	}
	if err := a.cp.Save(ctx, sess.State); err != nil {
		return nil, fmt.Errorf("save initial state: %w", err)
	}
	return sess, nil
}

// loadSession rebuilds a session from its last checkpoint. Does NOT emit
// session.start — caller does it after subscribing.
func (a *Agent) loadSession(ctx context.Context, id uuid.UUID) (*Session, error) {
	state, err := a.cp.Load(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("load checkpoint: %w", err)
	}
	writer := NewAsyncEventWriter(a.store, 4096)
	sess := &Session{
		State:  state,
		cfg:    a.cfg,
		subs:   make(map[*Sub]struct{}),
		ctx:    ctx,
		store:  a.store,
		cp:     a.cp,
		cache:  a.cache,
		router: a.router,
		tools:  a.tools,
		ctxMgr: NewContextManager(a.cfg.ContextMaxTokens),
		writer: writer,
		onSlowSubscriber: func(sub *Sub, e Event) {
			// Same as newSession
		},
		done: make(chan struct{}),
	}
	return sess, nil
}

// checkpoint snapshots current state. Non-blocking when possible.
func (s *Session) checkpoint() {
	s.mu.RLock()
	state := s.State
	state.UpdatedAt = time.Now()
	s.mu.RUnlock()
	if err := s.cp.Save(s.ctx, state); err != nil {
		s.emit(Event{Type: EventError, Payload: map[string]interface{}{"checkpoint_failed": err.Error()}})
		return
	}
	s.emit(Event{Type: EventCheckpoint, Payload: map[string]interface{}{"step": state.Step}})
}

// DeliverToolResult routes a frontend tool result back to the waiting
// FrontendTool.Execute call. Call this from the HTTP/SSE handler when
// a frontend client sends a tool.result event back over the stream.
//
// Usage:
//   // In your HTTP handler, when you receive a tool_result from the frontend:
//   session.DeliverToolResult(callID, result, err)
func (s *Session) DeliverToolResult(callID string, result interface{}, err error) {
	s.mu.RLock()
	tools := s.tools
	s.mu.RUnlock()
	for _, t := range tools {
		if ft, ok := t.(*FrontendTool); ok {
			ft.DeliverResult(callID, result, err)
		}
	}
}
