package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

// AnthropicRouter is a real Claude LLM router with tool-use support.
// (The Anvil engine has a StubLLMRouter; this is the real one for
// the Perplexity clone.)
type AnthropicRouter struct {
	APIKey string
	Model  string
	Client *http.Client
}

// NewAnthropicRouter creates the router. ANTHROPIC_API_KEY env var required.
// Model defaults to "claude-3-5-haiku-latest" for speed; override for quality.
func NewAnthropicRouter() *AnthropicRouter {
	return &AnthropicRouter{
		APIKey: os.Getenv("ANTHROPIC_API_KEY"),
		Model:  "claude-3-5-haiku-latest",
		Client: &http.Client{Timeout: 60 * time.Second},
	}
}

// Name implements the LLMRouter interface.
func (r *AnthropicRouter) Name() string { return "anthropic" }

// Message is the wire format from the engine to the LLM.
type Message struct {
	Role    string    `json:"role"` // system, user, assistant
	Content string    `json:"content"`
}

// Tool is the tool spec the LLM can call.
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// LLMRequest is what the engine sends to the router.
type LLMRequest struct {
	SystemPrompt string
	Messages     []Message
	Tools        []Tool
	MaxTokens    int
}

// LLMResponse is what the router returns.
type LLMResponse struct {
	Content   string
	ToolCalls []ToolCall
	StopReason string
	Usage     TokenUsage
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

// Stream implements the LLMRouter interface.
func (r *AnthropicRouter) Stream(ctx context.Context, req LLMRequest, onDelta func(string)) (LLMResponse, error) {
	if r.APIKey == "" {
		return LLMResponse{}, fmt.Errorf("anthropic: ANTHROPIC_API_KEY not set")
	}

	// Build the request body
	type anthropicTool struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		InputSchema map[string]interface{} `json:"input_schema"`
	}
	type anthropicMessage struct {
		Role    string                   `json:"role"`
		Content []map[string]interface{} `json:"content"`
	}
	type anthropicReq struct {
		Model     string             `json:"model"`
		MaxTokens int                `json:"max_tokens"`
		System    string             `json:"system,omitempty"`
		Messages  []anthropicMessage `json:"messages"`
		Tools     []anthropicTool    `json:"tools,omitempty"`
		Stream    bool               `json:"stream"`
	}

	body := anthropicReq{
		Model:     r.Model,
		MaxTokens: req.MaxTokens,
		System:    req.SystemPrompt,
		Stream:    true,
	}
	if body.MaxTokens == 0 {
		body.MaxTokens = 4096
	}
	// Convert tools
	for _, t := range req.Tools {
		body.Tools = append(body.Tools, anthropicTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}
	// Convert messages — turn any with tool_use into assistant content blocks
	for _, m := range req.Messages {
		am := anthropicMessage{Role: m.Role}
		am.Content = append(am.Content, map[string]interface{}{
			"type": "text",
			"text": m.Content,
		})
		body.Messages = append(body.Messages, am)
	}

	jsonBody, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, "POST",
		"https://api.anthropic.com/v1/messages", strings.NewReader(string(jsonBody)))
	if err != nil {
		return LLMResponse{}, err
	}
	httpReq.Header.Set("content-type", "application/json")
	httpReq.Header.Set("x-api-key", r.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("anthropic-beta", "messages-2023-12-15")

	resp, err := r.Client.Do(httpReq)
	if err != nil {
		return LLMResponse{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return LLMResponse{}, fmt.Errorf("anthropic: %d %s", resp.StatusCode, string(b))
	}

	// Parse SSE stream
	// Events: message_start, content_block_start, content_block_delta, content_block_stop,
	// tool_use, message_delta, message_stop, error
	type sseEvent struct {
		Type  string                 `json:"type"`
		Index int                    `json:"index"`
		Delta map[string]interface{} `json:"delta,omitempty"`
		ContentBlock map[string]interface{} `json:"content_block,omitempty"`
		Message map[string]interface{} `json:"message,omitempty"`
	}

	dec := json.NewDecoder(resp.Body)
	var (
		fullText strings.Builder
		toolCalls []ToolCall
		usage    = TokenUsage{}
		currentTool map[string]interface{}
	)

	for {
		var ev sseEvent
		if err := dec.Decode(&ev); err != nil {
			if err == io.EOF {
				break
			}
			return LLMResponse{}, err
		}
		switch ev.Type {
		case "message_start":
			if msg, ok := ev.Message["usage"].(map[string]interface{}); ok {
				if v, ok := msg["input_tokens"].(float64); ok {
					usage.InputTokens = int(v)
				}
			}
		case "content_block_start":
			if cb, ok := ev.ContentBlock["type"].(string); ok && cb == "tool_use" {
				currentTool = map[string]interface{}{
					"id":    ev.ContentBlock["id"],
					"name":  ev.ContentBlock["name"],
					"input": "",
				}
			}
		case "content_block_delta":
			if delta, ok := ev.Delta["type"].(string); ok && delta == "text_delta" {
				if text, ok := ev.Delta["text"].(string); ok {
					fullText.WriteString(text)
					if onDelta != nil {
						onDelta(text)
					}
				}
			} else if delta == "input_json_delta" {
				if pj, ok := ev.Delta["partial_json"].(string); ok && currentTool != nil {
					if s, ok := currentTool["input"].(string); ok {
						currentTool["input"] = s + pj
					}
				}
			}
		case "content_block_stop":
			if currentTool != nil {
				inputStr, _ := currentTool["input"].(string)
				tc := ToolCall{
					ID:    currentTool["id"].(string),
					Name:  currentTool["name"].(string),
					Input: json.RawMessage(inputStr),
				}
				toolCalls = append(toolCalls, tc)
				currentTool = nil
			}
		case "message_delta":
			if msg, ok := ev.Delta["usage"].(map[string]interface{}); ok {
				if v, ok := msg["output_tokens"].(float64); ok {
					usage.OutputTokens = int(v)
				}
			}
		}
	}

	return LLMResponse{
		Content:    fullText.String(),
		ToolCalls:  toolCalls,
		StopReason: "end_turn",
		Usage:      usage,
	}, nil
}

// uuid import shim (used in agents below)
var _ = uuid.Nil
