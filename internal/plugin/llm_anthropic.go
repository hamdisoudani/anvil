package plugin

import (
	"context"
)

// StubAnthropicRouter is a placeholder for the real Anthropic LLM router.
//
// The real implementation would use anthropic-sdk-go, handle prompt caching
// (cache_control blocks), stream tool calls, and report cache_read /
// cache_write token counts for billing observability.
//
// This stub returns a deterministic response so the plugin interface can
// be tested without API keys.
type StubAnthropicRouter struct {
	Responses []string
	CallCount int
}

// NewStubAnthropicRouter returns a stub that emits the given responses in
// sequence. Replace with the real AnthropicRouter in production.
func NewStubAnthropicRouter(responses ...string) *StubAnthropicRouter {
	return &StubAnthropicRouter{Responses: responses}
}

// Stream implements LLMRouter by emitting a deterministic response.
func (r *StubAnthropicRouter) Stream(ctx context.Context, req LLMRequest) (<-chan LLMChunk, error) {
	ch := make(chan LLMChunk, 16)
	go func() {
		defer close(ch)
		text := "stub-anthropic-response"
		if r.CallCount < len(r.Responses) {
			text = r.Responses[r.CallCount]
		}
		r.CallCount++

		// Simulate streaming
		for i := 0; i < len(text); i += 4 {
			end := i + 4
			if end > len(text) {
				end = len(text)
			}
			select {
			case ch <- LLMChunk{Delta: text[i:end]}:
			case <-ctx.Done():
				return
			}
		}
		// Report cache hit
		ch <- LLMChunk{
			Done: true,
			Usage: &TokenUsage{
				InputTokens:  100,
				OutputTokens: len(text) / 4,
				Cached:       true,
				CacheRead:    80,
			},
		}
	}()
	return ch, nil
}

// Embed returns deterministic fake embeddings (for RAG testing).
func (r *StubAnthropicRouter) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i := range texts {
		// 768-dim fake embedding (Anthropic's real size)
		emb := make([]float32, 768)
		for j := range emb {
			emb[j] = float32(i+j) / 1000.0
		}
		out[i] = emb
	}
	return out, nil
}

// Compile-time check
var _ LLMRouter = (*StubAnthropicRouter)(nil)

// RealAnthropicRouter is a placeholder for the production implementation.
//
// To implement, add anthropic-sdk-go to go.mod and:
//
// func NewRealAnthropicRouter(apiKey, model string) *RealAnthropicRouter {
//     return &RealAnthropicRouter{
//         client: anthropic.NewClient(apiKey),
//         model:  model,
//     }
// }
//
// func (r *RealAnthropicRouter) Stream(ctx context.Context, req LLMRequest) (<-chan LLMChunk, error) {
//     // Build the streaming request
//     // Use req.CacheKey to set cache_control breakpoints
//     // Stream back via channel, marking tool_use blocks
//     // Report usage.usage.input_tokens, output_tokens, cache_read_input_tokens
// }
type RealAnthropicRouter struct {
	// Real impl: client anthropic.Client, model string
	_ struct{} // placeholder
}
