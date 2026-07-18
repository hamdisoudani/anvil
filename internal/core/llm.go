package core

import "context"

// LLMRouter picks the right model, handles prompt caching, streams output.
//
// Three knobs that matter for speed and cost:
//   1. Prompt cache (Anthropic charges 90% less for cached system/tool prompts)
//   2. Model cascade (try cheap model first, escalate if confidence low)
//   3. Speculative streaming (fire predictions, cancel on mismatch)
type LLMRouter interface {
	Stream(ctx context.Context, req LLMRequest) (<-chan LLMChunk, error)
}

type LLMRequest struct {
	System      string                 // system prompt (cacheable)
	Messages    []Message              // conversation
	Tools       []ToolSchema           // tool definitions (cacheable)
	MaxTokens   int
	Temperature float64
	Model       string                 // hint, router may override
	CacheKey    string                 // for explicit cache hits
	StepID      int                    // for cache versioning
}

type LLMChunk struct {
	Delta   string                 // token delta
	ToolUse *ToolCallRequest       // set when model picks a tool
	Done    bool                   // stream finished
	Usage   *TokenUsage            // token counts, set on Done
	Err     error                  // set on error
}

type TokenUsage struct {
	InputTokens  int
	OutputTokens int
	CacheRead    int  // tokens served from cache (Anthropic 90% discount)
	CacheWrite   int  // tokens written to cache (Anthropic 25% surcharge)
	Cached       bool // true if this request was a cache hit
}

type ToolSchema struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

type ToolCallRequest struct {
	ID    string                 `json:"id"`
	Name  string                 `json:"name"`
	Input map[string]interface{} `json:"input"`
}

// Action is what the LLM decided. The engine routes this to the right place.
type Action struct {
	IsFinal  bool
	AnswerV  string
	ToolCall *ToolCallRequest
	Message  Message
	Usage    TokenUsage
}

func (a Action) IsTool() bool { return a.ToolCall != nil }

func (a Action) Event() map[string]interface{} {
	if a.ToolCall == nil {
		return map[string]interface{}{}
	}
	return map[string]interface{}{
		"id":    a.ToolCall.ID,
		"name":  a.ToolCall.Name,
		"input": a.ToolCall.Input,
	}
}

func (a Action) Answer() string { return a.AnswerV }

// think is one LLM call. It packages the context, streams, and returns an Action.
func (s *Session) think() (Action, error) {
	messages := s.ctxMgr.Pack(s.State)
	chunks, err := s.router.Stream(s.ctx, LLMRequest{
		System:      s.ctxMgr.SystemPrompt(),
		Messages:    messages,
		Tools:       s.toolSchemas(),
		MaxTokens:   8192,
		Temperature: 1.0,
		Model:       s.pickModel(),
		CacheKey:    s.ctxMgr.CacheKey(),
		StepID:      s.State.Step,
	})
	if err != nil {
		return Action{}, err
	}

	s.emit(Event{Type: EventThinkStart, Payload: map[string]interface{}{"step": s.State.Step}})
	var textBuf []byte
	var toolCall *ToolCallRequest
	var usage TokenUsage
	for chunk := range chunks {
		if chunk.Err != nil {
			return Action{}, chunk.Err
		}
		if chunk.Delta != "" {
			textBuf = append(textBuf, chunk.Delta...)
			s.emit(Event{Type: EventThinkChunk, Payload: map[string]interface{}{"delta": chunk.Delta}})
		}
		if chunk.ToolUse != nil {
			toolCall = chunk.ToolUse
		}
		if chunk.Done {
			usage = *chunk.Usage
		}
	}
	s.emit(Event{Type: EventThinkEnd, Payload: map[string]interface{}{"usage": usage}})

	return Action{
		ToolCall: toolCall,
		Message:  Message{Role: "assistant", Content: string(textBuf)},
		Usage:    usage,
		IsFinal:  toolCall == nil && string(textBuf) != "",
		AnswerV:  string(textBuf),
	}, nil
}

// pickModel returns the model hint. The router may override based on step
// complexity (e.g. classification vs reasoning).
func (s *Session) pickModel() string {
	return "claude-sonnet-4-5"
}

func (s *Session) toolSchemas() []ToolSchema {
	out := make([]ToolSchema, 0, len(s.tools))
	for _, t := range s.tools {
		out = append(out, ToolSchema{
			Name:        t.Name(),
			Description: t.Description(),
			InputSchema: t.Schema(),
		})
	}
	return out
}
