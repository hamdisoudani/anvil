package plugin

import (
	"context"
	"testing"
)

// TestJSONActionCodec verifies the default action representation works.
func TestJSONActionCodec(t *testing.T) {
	c := NewJSONActionCodec()
	if c.Name() != "json" {
		t.Errorf("expected name 'json', got %s", c.Name())
	}

	// Encode
	action, err := c.Encode("calculator", map[string]interface{}{"expression": "2+2"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if action.ToolCall == nil {
		t.Fatal("no tool call in encoded action")
	}
	if action.ToolCall.Name != "calculator" {
		t.Errorf("wrong tool name: %s", action.ToolCall.Name)
	}
	if action.ToolCall.Input["expression"] != "2+2" {
		t.Errorf("wrong args: %v", action.ToolCall.Input)
	}

	// Decode
	decoded, err := c.Decode([]byte(`{"name":"x","args":{}}`))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded == nil {
		t.Fatal("nil decode result")
	}
}

// TestRunRecord_BasicShape verifies the canonical record has all the
// fields needed for observability and replay.
func TestRunRecord_BasicShape(t *testing.T) {
	rec := RunRecord{
		ThreadID:   "t1",
		Step:       5,
		StateRef:   "ckpt-123",
		Action:     Action{ToolCall: &ToolCallRequest{Name: "nmap"}},
		Cost:       0.0023,
		Tokens:     TokenUsage{InputTokens: 100, OutputTokens: 50},
		Latency:    1500e6, // 1.5s
		PluginName: "anthropic-llm",
	}

	if rec.ThreadID != "t1" {
		t.Error("thread_id wrong")
	}
	if rec.Step != 5 {
		t.Error("step wrong")
	}
	if rec.Action.ToolCall.Name != "nmap" {
		t.Error("action wrong")
	}
	if rec.Cost != 0.0023 {
		t.Error("cost wrong")
	}
	if rec.PluginName == "" {
		t.Error("plugin name should be set for profiler")
	}
}

// TestHandoffPolicy_Stub verifies a basic handoff decision.
type stubHandoff struct {
	next string
}

func (s *stubHandoff) Name() string { return "stub" }
func (s *stubHandoff) Decide(ctx context.Context, current AgentRef, message Message, peers []AgentRef) (*AgentRef, error) {
	if s.next == "" {
		return nil, nil // done
	}
	for i := range peers {
		if peers[i].Role == s.next {
			return &peers[i], nil
		}
	}
	return nil, nil
}

func TestHandoffPolicy_Stub(t *testing.T) {
	h := &stubHandoff{next: "writer"}
	peers := []AgentRef{
		{ID: "1", Role: "researcher"},
		{ID: "2", Role: "writer"},
		{ID: "3", Role: "critic"},
	}
	next, err := h.Decide(context.Background(), peers[0], Message{Role: "user", Content: "go"}, peers)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if next == nil || next.Role != "writer" {
		t.Error("expected writer next")
	}
}
