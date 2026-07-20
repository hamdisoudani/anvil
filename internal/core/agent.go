// Package core: the Anvil agent engine.
//
// "Hit it hard. It remembers."
//
// This is the brain, not the body. The engine runs a think-act-observe loop,
// persists every event to Postgres, checkpoints state, and can resume from
// any checkpoint. The caller (AG-UI frontend, A2A peer, CLI) just feeds it
// tasks and reads events — this binary does not know what AG-UI is.
package core

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Event is the smallest unit of progress the agent emits.
// Append-only, never updated, source of truth for resume.
type Event struct {
	ID         int64                  `json:"-"`           // Postgres serial, internal ordering
	EventID    string                 `json:"event_id"`    // client-visible monotonic, stable across resume
	SessionID  uuid.UUID              `json:"session_id"`
	Type       EventType              `json:"type"`
	Payload    map[string]interface{} `json:"payload"`
	CreatedAt  time.Time              `json:"created_at"`
}

type EventType string

const (
	EventSessionStart EventType = "session.start"
	EventThinkStart   EventType = "think.start"
	EventThinkChunk   EventType = "think.chunk"  // streamed token from LLM
	EventThinkEnd     EventType = "think.end"
	EventToolCall     EventType = "tool.call"     // agent decided to call a tool
	EventToolResult   EventType = "tool.result"   // tool returned
	EventCheckpoint   EventType = "checkpoint"    // state snapshot saved
	EventSubagent     EventType = "subagent"      // delegated to sub-agent
	EventError        EventType = "error"
	EventDone         EventType = "done"
	EventPaused       EventType = "paused"        // stopped, can resume
)

// State is everything the agent needs to continue a session.
// Snapshot every N steps. Source of truth for crash recovery.
type State struct {
	SessionID    uuid.UUID              `json:"session_id"`
	Step         int                    `json:"step"`
	Plan         []PlanStep             `json:"plan"`
	Scratchpad   map[string]interface{} `json:"scratchpad"`   // current working memory
	History      []Message              `json:"history"`      // recent messages
	LongTerm     string                 `json:"long_term"`    // compressed older
	ToolRegistry map[string]Tool        `json:"-"`            // not serialized
	LastEventID  int64                  `json:"last_event_id"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

type PlanStep struct {
	ID       string `json:"id"`
	Intent   string `json:"intent"`
	Status   string `json:"status"`   // pending | in_progress | done | failed
	Tool     string `json:"tool,omitempty"`
	Args     map[string]interface{} `json:"args,omitempty"`
	Result   interface{}            `json:"result,omitempty"`
}

type Message struct {
	Role    string `json:"role"`    // system | user | assistant | tool
	Content string `json:"content"`
	ToolID  string `json:"tool_id,omitempty"`
}

// Tool is anything the agent can call. Wrapped with idempotency by the engine.
type Tool interface {
	Name() string
	Description() string
	Schema() map[string]interface{}  // JSON schema for args
	Execute(ctx context.Context, args map[string]interface{}) (interface{}, error)
}

// Session is a single agent run. Created on task start, ends on Done/Paused.
type Session struct {
	State   State
	cfg     Config
	mu      sync.RWMutex
	subs    map[*Sub]struct{}  // live subscribers
	subMu   sync.RWMutex
	ctx     context.Context
	cancel  context.CancelFunc
	store   EventStore
	cp      CheckpointStore
	cache   Cache
	router  LLMRouter
	tools   map[string]Tool
	ctxMgr  *ContextManager
	writer  *AsyncEventWriter        // async event persistence
	recordStore RunRecordStore        // canonical run records (the "anvil replay" source)
	onSlowSubscriber func(sub *Sub, e Event) // hook for metrics
	logger  Logger
	done    chan struct{}
	middleware []Middleware
}

// ReadState safely reads the current step and history length. The HTTP
// server (and any external observer) must use this — not read State
// directly — because the loop goroutine mutates it. (Race-detector
// caught this: see TestServer_Status.)
// applyMiddleware wraps a step with all configured middleware.
// Returns the same step unchanged if no middleware is configured.
func (s *Session) applyMiddleware(step MiddlewareStep, mtype MiddlewareType) MiddlewareStep {
	if len(s.middleware) == 0 {
		return step
	}
	wrapped := step
	for i := len(s.middleware) - 1; i >= 0; i-- {
		m := s.middleware[i]
		current := wrapped // capture
		wrapped = m(func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error) {
			return current(ctx, req)
		})
	}
	return wrapped
}

func (s *Session) ReadState() (step int, subCount int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.State.Step, len(s.State.History)
}

// Agent is the top-level engine. One per process, runs many sessions.
type Agent struct {
	store       EventStore
	cp          CheckpointStore
	cache       Cache
	router      LLMRouter
	tools       map[string]Tool
	cfg         Config
	recordStore RunRecordStore
	middleware []Middleware
}

type Config struct {
	CheckpointEvery  int           // snapshot state every N steps
	MaxSteps         int           // hard cap on session length
	ContextMaxTokens int           // LLM context window
	CacheTTL         time.Duration // prompt cache TTL
	SemanticCacheSim float64       // similarity threshold for semantic hits
	IdempotencyTTL   time.Duration // how long to remember tool results
}

func DefaultConfig() Config {
	return Config{
		CheckpointEvery:  5,
		MaxSteps:         200,
		ContextMaxTokens: 200_000,
		CacheTTL:         5 * time.Minute,
		SemanticCacheSim: 0.92,
		IdempotencyTTL:   24 * time.Hour,
	}
}

// Run starts a new session for a given task. Returns immediately; the session
// runs in a goroutine and emits events through the returned channel.
func (a *Agent) Run(ctx context.Context, task string) (*Session, *Sub, error) {
	sess, err := a.newSession(ctx, task)
	if err != nil {
		return nil, nil, err
	}
	sub := sess.Stream("primary")
	sess.emit(Event{
		SessionID: sess.State.SessionID,
		Type:      EventSessionStart,
		Payload:   map[string]interface{}{"task": task},
	})
	go sess.loop()
	return sess, sub, nil
}

// Resume picks up a session from its last checkpoint. Returns a new event
// stream. The session continues with the same session_id.
func (a *Agent) Resume(ctx context.Context, sessionID uuid.UUID) (*Session, *Sub, error) {
	sess, err := a.loadSession(ctx, sessionID)
	if err != nil {
		return nil, nil, err
	}
	sub := sess.Stream("primary")
	sess.emit(Event{
		SessionID: sess.State.SessionID,
		Type:      EventSessionStart,
		Payload:   map[string]interface{}{"resumed": true, "from_step": sess.State.Step},
	})
	go sess.loop()
	return sess, sub, nil
}

// loop is the heart. Runs until done, paused, or context cancelled.
// Every step: think → act → observe → checkpoint (if due) → emit.
// Middleware is applied around LLM calls (s.think) and tool execution (s.executeTool).
func (s *Session) loop() {
	defer close(s.done)
	for {
		select {
		case <-s.ctx.Done():
			s.emit(Event{Type: EventPaused, Payload: map[string]interface{}{"reason": s.ctx.Err().Error()}})
			s.checkpoint()
			return
		default:
		}

		s.mu.Lock()
		if s.State.Step >= s.cfg.MaxSteps {
			s.emit(Event{Type: EventDone, Payload: map[string]interface{}{"reason": "max_steps"}})
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()

		// 1. Think — ask LLM what to do next (wrapped in middleware)
		stepStart := time.Now()
		action, err := s.think()
		if err != nil {
			s.emit(Event{Type: EventError, Payload: map[string]interface{}{"err": err.Error()}})
			s.checkpoint()
			return
		}

		// 2. Act — if a tool call, execute it (wrapped in middleware)
		var observation interface{}
		if action.IsTool() {
			s.emit(Event{Type: EventToolCall, Payload: action.Event()})
			result := s.executeTool(action)
			s.emit(Event{Type: EventToolResult, Payload: result.Event()})
			s.State.Scratchpad["last_observation"] = result
			observation = result.Result
		}

		// 3. Update state
		s.mu.Lock()
		s.State.Step++
		s.State.History = append(s.State.History, action.Message)
		s.mu.Unlock()

		// 3.5. Record the step
		s.recordStep(action, observation, time.Since(stepStart))

		// 4. Checkpoint on cadence
		if s.State.Step%s.cfg.CheckpointEvery == 0 {
			s.checkpoint()
		}

		// 5. Check for done
		if action.IsFinal {
			s.emit(Event{Type: EventDone, Payload: map[string]interface{}{"answer": action.Answer()}})
			return
		}
	}
}
