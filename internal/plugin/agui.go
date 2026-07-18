package plugin

import "context"

// AGUIStreamer formats events as AG-UI streaming events.
//
// AG-UI is the CopilotKit protocol for agent-to-UI streaming. It defines
// 16 standard events (RUN_STARTED, TEXT_MESSAGE_CONTENT, TOOL_CALL_START,
// etc.) and streams them over SSE as JSON.
//
// See: https://docs.copilotkit.ai/coagents/agent-to-ui
type AGUIStreamer struct{}

// NewAGUIStreamer returns an AG-UI compatible StreamFormatter.
func NewAGUIStreamer() StreamFormatter { return &AGUIStreamer{} }

// ContentType for the SSE response.
func (a *AGUIStreamer) ContentType() string { return "text/event-stream" }

// AGUIEvent is the wire-format event AG-UI clients expect.
type AGUIEvent struct {
	Type    string                 `json:"type"`              // RUN_STARTED, TEXT_MESSAGE_CONTENT, etc.
	RunID   string                 `json:"run_id,omitempty"`
	Payload map[string]interface{} `json:"payload,omitempty"`
}

// Format converts an internal Anvil Event to AG-UI format.
func (a *AGUIStreamer) Format(e Event) (any, error) {
	switch e.Type {
	case "session.start":
		return AGUIEvent{
			Type:    "RUN_STARTED",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "think.chunk":
		return AGUIEvent{
			Type:    "TEXT_MESSAGE_CONTENT",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "think.end":
		return AGUIEvent{
			Type:    "TEXT_MESSAGE_END",
			RunID:   e.SessionID.String(),
		}, nil
	case "tool.call":
		return AGUIEvent{
			Type:    "TOOL_CALL_START",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "tool.result":
		return AGUIEvent{
			Type:    "TOOL_CALL_END",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "checkpoint":
		return AGUIEvent{
			Type:    "STATE_SNAPSHOT",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "error":
		return AGUIEvent{
			Type:    "RUN_ERROR",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "done":
		return AGUIEvent{
			Type:    "RUN_FINISHED",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	case "paused":
		return AGUIEvent{
			Type:    "RUN_PAUSED",
			RunID:   e.SessionID.String(),
			Payload: e.Payload,
		}, nil
	default:
		// Pass through unknown events as generic AGUI messages
		return AGUIEvent{
			Type:    "CUSTOM",
			RunID:   e.SessionID.String(),
			Payload: map[string]interface{}{"anvil_type": e.Type, "data": e.Payload},
		}, nil
	}
}

// Compile-time check
var _ StreamFormatter = (*AGUIStreamer)(nil)
var _ = context.Background
