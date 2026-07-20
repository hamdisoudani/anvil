package perplexity

import (
	"bufio"
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
	// Convert messages
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
	// Anthropic sends lines like:
	//   event: message_start
	//   data: {"type":"message_start",...}
	//
	// We must read line-by-line (not json.NewDecoder) because "event:" lines
	// are not valid JSON. Same pattern as openai_compat.go.
	type sseEvent struct {
		Type         string                 `json:"type"`
		Index        int                    `json:"index"`
		Delta        map[string]interface{} `json:"delta,omitempty"`
		ContentBlock map[string]interface{} `json:"content_block,omitempty"`
		Message      map[string]interface{} `json:"message,omitempty"`
	}

	var (
		fullText    strings.Builder
		toolCalls   []ToolCall
		usage       = TokenUsage{}
		currentTool map[string]interface{}
	)

	reader := bufio.NewReader(resp.Body)
	var ev sseEvent
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return LLMResponse{}, err
		}
		line = strings.TrimRight(line, "\r\n")
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				continue // skip malformed data lines
			}
		} else {
			continue // skip "event:" lines, blank lines, etc.
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
					ID:    safeStr(currentTool["id"]),
					Name:  safeStr(currentTool["name"]),
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

	// Extract stop_reason from the last message_delta if possible
	stopReason := "end_turn"
	if ev.Delta != nil {
		if sr, ok := ev.Delta["stop_reason"].(string); ok && sr != "" {
			stopReason = sr
		}
	}

	return LLMResponse{
		Content:    fullText.String(),
		ToolCalls:  toolCalls,
		StopReason: stopReason,
		Usage:      usage,
	}, nil
}

// safeStr returns s if non-nil, else "". Avoids nil dereference on type assertions.
func safeStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// uuid import shim (used in agents below)
var _ = uuid.Nil
