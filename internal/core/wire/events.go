// Package wire defines the canonical Anvil wire-protocol schema (Go side).
//
// This package is the SINGLE SOURCE OF TRUTH for the Go side of the
// Anvil wire protocol. JSON tags must match the TypeScript canonical
// schema in `sdk/packages/anvil-client/src/schema.ts` exactly.
//
// Both client and server are pinned to this contract. Adding a new
// event type requires updating the TypeScript discriminated union
// and this file in the same commit.
//
// The existing `core.Event` (in `internal/core/agent.go`) is the
// legacy in-memory event shape used by the new core agent runtime.
// This `wire.Event` is the canonical shape used on the wire AND by
// the `perplexity` server (the current production server). The two
// will be unified when the new core agent ships.
//
// Schema version: 1
package wire

import "encoding/json"

// Canonical Anvil wire-protocol schema (Go side).
//
// This file is the SINGLE SOURCE OF TRUTH for the Go side of the
// Anvil wire protocol. JSON tags must match the TypeScript canonical
// schema in `sdk/packages/anvil-client/src/schema.ts` exactly.
//
// Both client and server are pinned to this contract. Adding a new
// event type requires updating the TypeScript discriminated union
// and this file in the same commit.

// EventType is the discriminator literal on the wire. Values must
// match `EVENT_TYPES` in the TypeScript schema (no prefix, no
// abbreviation drift).
type EventType string

const (
	EventSessionStart  EventType = "session.start"
	EventThinkStart    EventType = "think.start"
	EventThinkChunk    EventType = "think.chunk"
	EventThinkEnd      EventType = "think.end"
	EventPlanStep      EventType = "plan.step"
	EventPlanSet       EventType = "plan.set"
	EventSourcesFound  EventType = "sources.found"
	EventAnswerChunk   EventType = "answer.chunk"
	EventAnswerEnd     EventType = "answer.end"
	EventToolCall      EventType = "tool.call"
	EventToolResult    EventType = "tool.result"
	EventFrontendCall  EventType = "frontend.call"
	EventSubagentStart EventType = "subagent.start"
	EventSubagentEnd   EventType = "subagent.end"
	EventCheckpoint    EventType = "checkpoint"
	EventAnvilDropped  EventType = "anvil.dropped"
	EventError         EventType = "error"
	EventPaused        EventType = "paused"
	EventDone          EventType = "done"
	EventReady         EventType = "ready"
)

// Event is the wire-format event. JSON field names match the TS
// schema exactly (`event_id`, `session_id`, `thread_id`,
// `created_at`). The `payload` is typed by the event's `type`.
//
// Why `Payload any` instead of a generic? Because the wire format
// must remain forward-compatible — new event types can ship from
// the server before the client knows about them, and we cannot
// force every event to pre-declare its shape. Use the typed
// constructors (`NewSessionStartEvent`, `NewThinkChunkEvent`, …)
// inside the agent to avoid runtime mistakes.
type Event struct {
	EventID   int64       `json:"event_id"`
	Type      EventType   `json:"type"`
	SessionID string      `json:"session_id"`
	ThreadID  string      `json:"thread_id,omitempty"`
	Payload   any         `json:"payload"`
	CreatedAt string      `json:"created_at"`
}

// Payload structs — exported so call sites can build typed events.
// Naming convention: <EventType>Payload, camelCase JSON tags to
// match the TypeScript discriminated union.

// SessionStartPayload — emitted when a new turn begins.
type SessionStartPayload struct {
	Task     string `json:"task"`
	ThreadID string `json:"threadId"`
	Focus    string `json:"focus,omitempty"`
}

// ThinkStartPayload — LLM thinking started.
type ThinkStartPayload struct {
	StepIndex int `json:"stepIndex"`
}

// ThinkChunkPayload — streamed token from the LLM.
type ThinkChunkPayload struct {
	Delta string `json:"delta"`
}

// ThinkEndPayload — LLM thinking finished.
type ThinkEndPayload struct {
	Text   string             `json:"text"`
	Tokens *ThinkChunkTokens  `json:"tokens,omitempty"`
}

// ThinkChunkTokens — optional token usage reported on think.end.
type ThinkChunkTokens struct {
	Input  *int `json:"input,omitempty"`
	Output *int `json:"output,omitempty"`
}

// AnswerChunkPayload — streamed final-answer token.
type AnswerChunkPayload struct {
	Delta string `json:"delta"`
}

// AnswerEndPayload — final answer finished.
type AnswerEndPayload struct {
	Text string `json:"text"`
}

// SubQuery — a decomposed query in the agent's plan.
type SubQuery struct {
	ID        string   `json:"id"`
	Query     string   `json:"query"`
	Intent    string   `json:"intent"`
	Source    string   `json:"source,omitempty"`
	Year      *int     `json:"year,omitempty"`
	DependsOn []string `json:"dependsOn,omitempty"`
}

// PlanObject — the plan delivered with `plan.set`.
type PlanObject struct {
	Reason          string     `json:"reason,omitempty"`
	SynthesizeHint  string     `json:"synthesizeHint,omitempty"`
	NeedsSearch     *bool      `json:"needsSearch,omitempty"`
	SubQueries      []SubQuery `json:"subQueries"`
}

// PlanStep — a single plan-step transition.
type PlanStep struct {
	ID     string  `json:"id"`
	Intent string  `json:"intent"`
	Detail string  `json:"detail,omitempty"`
	Status string  `json:"status"` // pending | running | done | error
	Tool   string  `json:"tool,omitempty"`
	Index  int     `json:"index"`
}

// PlanSetPayload — full plan object delivered.
type PlanSetPayload struct {
	Plan PlanObject `json:"plan"`
}

// PlanStepPayload — single step transition.
type PlanStepPayload struct {
	Step PlanStep `json:"step"`
}

// AgentSource — a discovered source.
type AgentSource struct {
	ID     int    `json:"id"`
	URL    string `json:"url"`
	Title  string `json:"title"`
	Domain string `json:"domain"`
}

// SourcesFoundPayload — sources discovered.
type SourcesFoundPayload struct {
	Sources []AgentSource `json:"sources"`
}

// ToolCallPayload — agent decided to call a tool.
// `Input` is json.RawMessage so it preserves the raw JSON bytes the
// LLM produced (e.g. `{"color":"darkblue"}`) instead of being
// re-marshaled to a base64 array by Go's `any` encoder.
type ToolCallPayload struct {
	Name       string          `json:"name"`
	Input      json.RawMessage `json:"input,omitempty"`
	CallID     string          `json:"id"` // legacy event uses "id", not "callId"
	IsFrontend bool            `json:"is_frontend,omitempty"`
}

// ToolResultPayload — tool returned.
type ToolResultPayload struct {
	Name   string `json:"name"`
	CallID string `json:"id"` // match legacy "id" key for symmetry
	Result any    `json:"result"`
	Error  string `json:"error,omitempty"`
}

// FrontendCallPayload — browser-side tool requested.
type FrontendCallPayload struct {
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input,omitempty"`
	CallID string          `json:"id"` // match legacy "id" key
}

// SubagentStartPayload — delegated to sub-agent.
type SubagentStartPayload struct {
	SubID string `json:"subId"`
	Role  string `json:"role"`
	Task  string `json:"task"`
}

// SubagentEndPayload — sub-agent finished.
type SubagentEndPayload struct {
	SubID  string `json:"subId"`
	Output any    `json:"output"`
}

// CheckpointPayload — state snapshot saved.
type CheckpointPayload struct {
	Step int `json:"step"`
}

// AnvilDroppedPayload — server dropped events.
type AnvilDroppedPayload struct {
	Count  int `json:"count"`
	LastID int `json:"lastId"`
}

// ErrorPayload — agent error.
type ErrorPayload struct {
	Message    string `json:"message"`
	Code       string `json:"code,omitempty"`
	Severity   string `json:"severity,omitempty"` // info | warning | error | fatal
	Recoverable *bool `json:"recoverable,omitempty"`
	Retryable   *bool `json:"retryable,omitempty"`
	StepID     string `json:"step_id,omitempty"`
	Raw        any    `json:"raw,omitempty"`
}

// DonePayload — terminal event.
type DonePayload struct {
	Answer  string       `json:"answer,omitempty"`
	Sources []AgentSource `json:"sources,omitempty"`
	Related []string     `json:"related,omitempty"`
	Plan    *PlanObject  `json:"plan,omitempty"`
	Reason  string       `json:"reason,omitempty"` // completed | cancelled | max_steps | error
	Steps   *int         `json:"steps,omitempty"`
}

// PausedPayload — session paused.
type PausedPayload struct {
	Reason   string `json:"reason"`
	ResumeAt string `json:"resumeAt,omitempty"`
}

// ReadyPayload — control frame, not an agent event.
type ReadyPayload struct {
	SessionID    string `json:"sessionId"`
	ResumeFromID *int   `json:"resumeFromId,omitempty"`
}

// ── Typed constructors ───────────────────────────────────────────────
//
// Use these to build events. They auto-populate `Type` and `Payload`,
// removing the risk of mismatched (type, payload) pairs.

func NewSessionStartEvent(sessionID, threadID, task, focus, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventSessionStart,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   SessionStartPayload{Task: task, ThreadID: threadID, Focus: focus},
		CreatedAt: createdAt,
	}
}

func NewThinkChunkEvent(sessionID, threadID, delta, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventThinkChunk,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   ThinkChunkPayload{Delta: delta},
		CreatedAt: createdAt,
	}
}

func NewThinkEndEvent(sessionID, threadID, text, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventThinkEnd,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   ThinkEndPayload{Text: text},
		CreatedAt: createdAt,
	}
}

func NewPlanStepEvent(sessionID, threadID string, step PlanStep, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventPlanStep,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   PlanStepPayload{Step: step},
		CreatedAt: createdAt,
	}
}

func NewPlanSetEvent(sessionID, threadID string, plan PlanObject, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventPlanSet,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   PlanSetPayload{Plan: plan},
		CreatedAt: createdAt,
	}
}

func NewSourcesFoundEvent(sessionID, threadID string, sources []AgentSource, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventSourcesFound,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   SourcesFoundPayload{Sources: sources},
		CreatedAt: createdAt,
	}
}

func NewAnswerChunkEvent(sessionID, threadID, delta, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventAnswerChunk,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   AnswerChunkPayload{Delta: delta},
		CreatedAt: createdAt,
	}
}

func NewAnswerEndEvent(sessionID, threadID, text, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventAnswerEnd,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   AnswerEndPayload{Text: text},
		CreatedAt: createdAt,
	}
}

func NewToolCallEvent(sessionID, threadID, name, callID string, input json.RawMessage, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventToolCall,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   ToolCallPayload{Name: name, CallID: callID, Input: input},
		CreatedAt: createdAt,
	}
}

func NewToolResultEvent(sessionID, threadID, name, callID string, result any, errMsg, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventToolResult,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   ToolResultPayload{Name: name, CallID: callID, Result: result, Error: errMsg},
		CreatedAt: createdAt,
	}
}

func NewFrontendCallEvent(sessionID, threadID, name, callID string, input json.RawMessage, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventFrontendCall,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   FrontendCallPayload{Name: name, CallID: callID, Input: input},
		CreatedAt: createdAt,
	}
}

func NewErrorEvent(sessionID, threadID, message, code, severity string, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventError,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   ErrorPayload{Message: message, Code: code, Severity: severity},
		CreatedAt: createdAt,
	}
}

func NewDoneEvent(sessionID, threadID string, p DonePayload, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventDone,
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   p,
		CreatedAt: createdAt,
	}
}

func NewReadyEvent(sessionID string, resumeFromID *int, createdAt string, id int64) Event {
	return Event{
		EventID:   id,
		Type:      EventReady,
		SessionID: sessionID,
		Payload:   ReadyPayload{SessionID: sessionID, ResumeFromID: resumeFromID},
		CreatedAt: createdAt,
	}
}

// ── Thread history wire types ───────────────────────────────────────

// TurnRecord is the per-turn persistence record. The thread-history
// endpoint returns an array of these (one per user turn), each
// carrying EVERYTHING the React SDK needs to rehydrate both
// useChat (messages) and useAgentState (phase / plan / sources /
// steps / reasoning) WITHOUT requiring an event replay.
type TurnRecord struct {
	ID         string       `json:"id"`
	ThreadID   string       `json:"threadId"`
	SessionID  string       `json:"sessionId"`
	Question   string       `json:"question"`
	Answer     string       `json:"answer"`
	StartedAt  string       `json:"startedAt"`
	EndedAt    string       `json:"endedAt,omitempty"`
	Sources    []AgentSource `json:"sources,omitempty"`
	Related    []string     `json:"related,omitempty"`
	Plan       *PlanObject  `json:"plan,omitempty"`
	Steps      []PlanStep   `json:"steps,omitempty"`
	Reasoning  string       `json:"reasoning,omitempty"`
	Error      *ErrorPayload `json:"error,omitempty"`
	DoneReason string       `json:"doneReason,omitempty"`
}

// ThreadHistoryResponse is the wire shape returned by
// `GET /perplexity/thread/:id`.
type ThreadHistoryResponse struct {
	ThreadID   string       `json:"threadId"`
	SessionIDs []string     `json:"sessionIds"`
	Turns      []TurnRecord `json:"turns"`
}