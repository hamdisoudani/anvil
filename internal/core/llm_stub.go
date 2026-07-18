package core

import (
	"context"
	"fmt"
)

// StubLLMRouter is a fake LLM for testing the engine without an API key.
// Real impl in llm_anthropic.go would use anthropic-sdk-go.
//
// The stub alternates between returning text and a tool call so the loop
// actually runs through the think → act → observe → final path.
type StubLLMRouter struct {
	responses []string
	calls     int
}

func NewStubLLMRouter(responses ...string) *StubLLMRouter {
	return &StubLLMRouter{responses: responses}
}

func (r *StubLLMRouter) Stream(ctx context.Context, req LLMRequest) (<-chan LLMChunk, error) {
	ch := make(chan LLMChunk, 16)
	go func() {
		defer close(ch)
		var text string
		if r.calls < len(r.responses) {
			text = r.responses[r.calls]
		} else {
			text = fmt.Sprintf("stub response #%d", r.calls)
		}
		r.calls++

		// Even-numbered calls return a tool, odd calls return text
		var toolCall *ToolCallRequest
		if r.calls%2 == 0 {
			toolCall = &ToolCallRequest{
				ID:    fmt.Sprintf("tool-%d", r.calls),
				Name:  "calculator",
				Input: map[string]interface{}{"expression": "2 + 3"},
			}
		}

		// Simulate streaming
		chunks := splitChunks(text, 5)
		for _, c := range chunks {
			select {
			case ch <- LLMChunk{Delta: c}:
			case <-ctx.Done():
				return
			}
		}
		if toolCall != nil {
			ch <- LLMChunk{ToolUse: toolCall}
		}
		ch <- LLMChunk{
			Done:  true,
			Usage: &TokenUsage{InputTokens: 100, OutputTokens: len(text) / 4, Cached: true, CacheRead: 80},
		}
	}()
	return ch, nil
}

func splitChunks(s string, n int) []string {
	if n <= 0 || len(s) <= n {
		return []string{s}
	}
	var out []string
	for i := 0; i < len(s); i += n {
		end := i + n
		if end > len(s) {
			end = len(s)
		}
		out = append(out, s[i:end])
	}
	return out
}
