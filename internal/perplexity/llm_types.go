package perplexity

import "encoding/json"

// Shared types used by every LLM router (Anthropic, OpenAI-compatible, etc).

// Message is the wire format from the engine to the LLM.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Tool is the tool spec the LLM can call.
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema,omitempty"`
}

// LLMRequest is what the engine sends to the router.
type LLMRequest struct {
	SystemPrompt string
	Messages     []Message
	Tools        []Tool
	MaxTokens    int
	// ForceToolChoice: "auto" | "required" | "" (omit).
	// When "required", the model MUST call a tool (no text response).
	ForceToolChoice string
}

// LLMResponse is what the router returns.
type LLMResponse struct {
	Content    string
	ToolCalls  []ToolCall
	StopReason string
	Usage      TokenUsage
}

// ToolCall is when the LLM wants to call a tool.
type ToolCall struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

// TokenUsage tracks tokens used.
type TokenUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}
