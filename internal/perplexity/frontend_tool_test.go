package perplexity

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// mockLLMRouter is a stub LLMRouter for unit tests. It returns a
// canned response on the first call, then a final-text response on
// the second. Useful for exercising the frontend-tool roundtrip
// without involving the real Groq/OpenAI endpoint.
type mockLLMRouter struct {
	mu        sync.Mutex
	calls     int
	firstResp LLMResponse
	nextResp  LLMResponse
}

func (m *mockLLMRouter) Stream(ctx context.Context, req LLMRequest, onDelta func(string)) (LLMResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.calls == 1 {
		return m.firstResp, nil
	}
	return m.nextResp, nil
}

func TestOrchestrator_TryFrontendTools_Roundtrip(t *testing.T) {
	// 1. Build a mock LLM that:
	//    - First call: emits a tool call for change_background_color
	//    - Second call: emits a final "Done" text
	mock := &mockLLMRouter{
		firstResp: LLMResponse{
			Content: "",
			ToolCalls: []ToolCall{
				{
					ID:    "call_test_1",
					Name:  "change_background_color",
					Input: json.RawMessage(`{"color":"darkblue"}`),
				},
			},
		},
		nextResp: LLMResponse{
			Content:    "Color changed to darkblue.",
			ToolCalls:  nil,
		},
	}

	// 2. Build the orchestrator with one frontend tool.
	colorTool := NewFrontendTool(
		"change_background_color",
		"Change the chat UI's background color.",
		map[string]interface{}{"type": "object", "properties": map[string]interface{}{"color": map[string]interface{}{"type": "string"}}},
	)
	colorTool.SetTimeout(2 * time.Second)
	orch := NewOrchestrator(mock, nil, nil).WithFrontendTools(colorTool)

	// 3. Run the frontend-tool step in a goroutine so we can
	// deliver the browser result while it's blocked.
	ctx := context.Background()
	events := make(chan Event, 32)
	var finalText string
	var finalErr error
	doneCh := make(chan struct{})

	go func() {
		text, err := orch.tryFrontendTools(ctx, "change bg to darkblue", func(e Event) {
			events <- e
		}, nil)
		finalText = text
		finalErr = err
		close(doneCh)
	}()

	// 4. Wait for the tool.call event.
	var callID string
	deadline := time.After(3 * time.Second)
loop:
	for {
		select {
		case e := <-events:
			if e.Type == EventToolCall {
				if isFrontend, _ := e.Payload["is_frontend"].(bool); isFrontend {
					callID, _ = e.Payload["id"].(string)
					break loop
				}
			}
		case <-deadline:
			t.Fatal("timed out waiting for tool.call event")
		}
	}
	if callID == "" {
		t.Fatal("tool.call event had no id")
	}

	// 5. Simulate the browser delivering the result.
	colorTool.DeliverResult(callID, json.RawMessage(`{"applied":"darkblue","previous":null}`), "")

	// 6. Wait for tryFrontendTools to return.
	select {
	case <-doneCh:
	case <-time.After(3 * time.Second):
		t.Fatal("tryFrontendTools did not return")
	}

	// 7. Verify the orchestrator got the final acknowledgement text.
	if finalErr != nil {
		t.Fatalf("unexpected error: %v", finalErr)
	}
	if finalText != "Color changed to darkblue." {
		t.Fatalf("expected final text 'Color changed to darkblue.', got %q", finalText)
	}

	// 8. Verify we made 2 LLM calls (one to emit the tool call, one
	// to acknowledge the result).
	if mock.calls != 2 {
		t.Fatalf("expected 2 LLM calls, got %d", mock.calls)
	}

	// 9. Drain remaining events and confirm we got the matching
	// tool.result.
	gotResult := false
drain:
	for {
		select {
		case e := <-events:
			if e.Type == EventToolResult {
				if id, _ := e.Payload["id"].(string); id == callID {
					gotResult = true
				}
			}
		default:
			break drain
		}
	}
	if !gotResult {
		t.Fatal("expected tool.result event with matching call_id")
	}
}

// TestOrchestrator_TryFrontendTools_NoToolsRegistered is a no-op:
// when no frontend tools are attached, tryFrontendTools returns
// immediately with empty text and no LLM call.
func TestOrchestrator_TryFrontendTools_NoToolsRegistered(t *testing.T) {
	mock := &mockLLMRouter{}
	orch := NewOrchestrator(mock, nil, nil) // no frontend tools

	text, err := orch.tryFrontendTools(context.Background(), "anything", func(Event) {}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if text != "" {
		t.Fatalf("expected empty text, got %q", text)
	}
	if mock.calls != 0 {
		t.Fatalf("expected 0 LLM calls, got %d", mock.calls)
	}
}

// silence unused-import warning if uuid is unused after refactor.
var _ = uuid.Nil