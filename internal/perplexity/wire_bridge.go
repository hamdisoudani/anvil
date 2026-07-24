package perplexity

// Bridge between the legacy `perplexity.Event` (used by the current
// orchestrator) and the canonical `wire.Event` (the contract shared
// with the React SDK).
//
// Why a bridge? The orchestrator was written before the canonical
// schema existed; refactoring every `emit(...)` call to use the typed
// constructors is high risk for low immediate value. Instead, every
// event the orchestrator publishes passes through this converter so
// the wire format (and the payload shape) match the canonical schema.
//
// Migration path: when the orchestrator is rewritten against the new
// core agent runtime, delete this file. The TypeScript client will
// not notice (same wire format, same payloads).

import (
	"encoding/json"
	"time"

	"github.com/hamdisoudani/anvil/internal/core/wire"
)

// eventIDCounter is a process-local monotonic counter. Each event
// passing through this bridge gets a unique id. This is what the
// React SDK uses for Last-Event-ID resume and for thread history
// event sequencing.
var eventIDCounter int64

// toWireEvent converts a legacy `perplexity.Event` (loose map
// payload) into the canonical `wire.Event`. The payload is decoded
// into the typed struct matching the event's `type`.
//
// Unknown event types are passed through with their raw payload
// (the React SDK wraps them in `UnknownAnvilEvent`).
func toWireEvent(sessionID, threadID string, e Event) wire.Event {
	eventIDCounter++
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	return wire.Event{
		EventID:   eventIDCounter,
		Type:      wire.EventType(e.Type),
		SessionID: sessionID,
		ThreadID:  threadID,
		Payload:   decodePayload(e.Type, e.Payload),
		CreatedAt: ts,
	}
}

// decodePayload unmarshals the legacy map[string]interface{} into
// the typed payload matching the event type. We round-trip via JSON
// because the orchestrator constructs payloads with map literals
// (no struct type info).
//
// If unmarshaling fails (extra fields, missing fields), we fall back
// to the raw map — better to ship something than to drop the event.
func decodePayload(t EventType, raw map[string]interface{}) any {
	if raw == nil {
		raw = map[string]interface{}{}
	}
	// tool.call payloads use raw JSON bytes for `input` (the LLM's
	// tool-call arguments). `any` would marshal these to a base64
	// array; convert them to json.RawMessage so they pass through
	// the JSON encoder untouched.
	if wire.EventType(t) == wire.EventToolCall {
		if bs, ok := raw["input"].([]byte); ok {
			raw["input"] = json.RawMessage(bs)
		}
	}
	// Round-trip through JSON to apply struct tags.
	bytes, err := json.Marshal(raw)
	if err != nil {
		return raw
	}

	switch wire.EventType(t) {
	case wire.EventSessionStart:
		var p wire.SessionStartPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventThinkChunk:
		var p wire.ThinkChunkPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventThinkEnd:
		var p wire.ThinkEndPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventPlanStep:
		// Legacy orchestrator emits the step fields FLAT
		// ({id, intent, status, detail, tool, index}) while the
		// canonical wire shape nests them under `step`. Try the
		// nested form first; if that fails, fall back to a flat
		// unmarshal that lifts the top-level fields into Step.
		var p wire.PlanStepPayload
		if err := json.Unmarshal(bytes, &p); err == nil && (p.Step.ID != "" || p.Step.Intent != "" || p.Step.Status != "") {
			if p.Step.Index == 0 {
				p.Step.Index = int(eventIDCounter)
			}
			return p
		}
		var flat wire.PlanStep
		if err := json.Unmarshal(bytes, &flat); err == nil {
			if flat.Index == 0 {
				flat.Index = int(eventIDCounter)
			}
			return wire.PlanStepPayload{Step: flat}
		}
		// Both unmarshals failed — return empty payload so the
		// wire stays valid.
		return wire.PlanStepPayload{}
	case wire.EventPlanSet:
		var p wire.PlanSetPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventSourcesFound:
		var p wire.SourcesFoundPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventAnswerChunk:
		var p wire.AnswerChunkPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventAnswerEnd:
		var p wire.AnswerEndPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventToolCall:
		var p wire.ToolCallPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventToolResult:
		var p wire.ToolResultPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventFrontendCall:
		var p wire.FrontendCallPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			// Legacy publishers used a string callId derived from
			// session+timestamp; ensure it's populated for FrontendCall.
			if p.CallID == "" {
				p.CallID = time.Now().UTC().Format("fc-20060102150405.000000000")
			}
			return p
		}
	case wire.EventError:
		var p wire.ErrorPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventDone:
		var p wire.DonePayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	case wire.EventPaused:
		var p wire.PausedPayload
		if err := json.Unmarshal(bytes, &p); err == nil {
			return p
		}
	}

	// Unknown / unparseable — pass through.
	return raw
}