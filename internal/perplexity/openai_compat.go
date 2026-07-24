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
)

// OpenAICompatibleRouter is an LLM router that talks to any
// OpenAI-compatible chat completions endpoint with SSE streaming.
//
// Tested against:
//   - NVIDIA NIM (https://integrate.api.nvidia.com/v1)
//   - OpenAI (https://api.openai.com/v1)
//   - Together AI, Groq, OpenRouter, local vLLM — anything
//     that follows the OpenAI Chat Completions API spec
//
// Set:
//
//	OPENAI_API_KEY  →  Bearer token
//	OPENAI_BASE_URL →  e.g. "https://integrate.api.nvidia.com/v1"
//	OPENAI_MODEL    →  e.g. "meta/llama-3.1-70b-instruct"
type OpenAICompatibleRouter struct {
	APIKey      string
	BaseURL     string
	Model       string
	Client      *http.Client
	_OpenAIName string // provider label: "akarouter" | "ckey" | "vllm" | "openai-compatible"
}

// NewOpenAICompatibleRouter creates the router from env vars.
// Defaults to NVIDIA NIM with Llama 3.1 70B (fast, smart, free tier).
//
// Named-provider aliases (preferred over OPENAI_* when set):
//   - AKAROUTER_API_KEY / AKAROUTER_BASE_URL / AKAROUTER_MODEL  →  "akarouter"
//   - VLLM_API_KEY     / VLLM_BASE_URL     / VLLM_MODEL        →  "vllm"
//   - CKEY_API_KEY     / CKEY_BASE_URL     / CKEY_MODEL        →  "ckey"
func NewOpenAICompatibleRouter() *OpenAICompatibleRouter {
	key, base, model, label := pickOpenAIProvider()
	return &OpenAICompatibleRouter{
		APIKey:  key,
		BaseURL: base,
		Model:   model,
		Client:  &http.Client{Timeout: 120 * time.Second},
		// nameLabel is read by Name() via the package-level override below.
		_OpenAIName: label,
	}
}

// _OpenAIName is a sentinel field for the router's display label.
// Stored on the struct so main.go can see "akarouter" vs "openai-compatible"
// without changing the interface.
const _OpenAINameKey = "_openaiName"

// pickOpenAIProvider resolves which OpenAI-compatible provider to use.
//
// Precedence:
//  1. AKAROUTER_API_KEY set → akarouter  (https://akarouter.dev/v1)
//  2. CKEY_API_KEY     set → ckey        (https://ckey.vn/v1)
//  3. VLLM_API_KEY     set → vllm        (https://ckey.vn/v1 — alias for ckey)
//  4. OPENAI_API_KEY   set → "openai-compatible" (uses OPENAI_BASE_URL)
func pickOpenAIProvider() (key, base, model, label string) {
	switch {
	case os.Getenv("AKAROUTER_API_KEY") != "":
		key = os.Getenv("AKAROUTER_API_KEY")
		base = envOr("AKAROUTER_BASE_URL", "https://akarouter.dev/v1")
		model = envOr("AKAROUTER_MODEL", "akarouter/default")
		label = "akarouter"
	case os.Getenv("CKEY_API_KEY") != "":
		key = os.Getenv("CKEY_API_KEY")
		base = envOr("CKEY_BASE_URL", "https://ckey.vn/v1")
		model = envOr("CKEY_MODEL", "deepseek-v4-flash-free")
		label = "ckey"
	case os.Getenv("VLLM_API_KEY") != "":
		key = os.Getenv("VLLM_API_KEY")
		base = envOr("VLLM_BASE_URL", "https://ckey.vn/v1")
		model = envOr("VLLM_MODEL", "deepseek-v4-flash-free")
		label = "vllm"
	default:
		key = os.Getenv("OPENAI_API_KEY")
		base = envOr("OPENAI_BASE_URL", "https://integrate.api.nvidia.com/v1")
		model = envOr("OPENAI_MODEL", "meta/llama-3.1-70b-instruct")
		label = "openai-compatible"
	}
	return
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Name implements the LLMRouter interface.
func (r *OpenAICompatibleRouter) Name() string {
	if r._OpenAIName != "" {
		return r._OpenAIName
	}
	return "openai-compatible"
}

// openAIRequest is the wire format the OpenAI API expects.
// Uses messages array format (no top-level 'system' field) for
// maximum compatibility — Groq, Together, vLLM, and others
// don't support the non-standard 'system' field.
type openAIRequest struct {
	Model      string          `json:"model"`
	MaxTokens  int             `json:"max_tokens,omitempty"`
	Stream     bool            `json:"stream"`
	Messages   []openAIMessage `json:"messages"`
	Tools      []openAITool    `json:"tools,omitempty"`
	ToolChoice string          `json:"tool_choice,omitempty"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAITool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		Parameters  map[string]interface{} `json:"parameters"`
	} `json:"function"`
}

// logFirst returns the first n bytes of a string.
func logFirst(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// Stream implements the LLMRouter interface.
func (r *OpenAICompatibleRouter) Stream(ctx context.Context, req LLMRequest, onDelta func(string)) (LLMResponse, error) {
	if r.APIKey == "" {
		return LLMResponse{}, fmt.Errorf("openai-compatible: OPENAI_API_KEY not set (env var)")
	}

	body := openAIRequest{
		Model:     r.Model,
		MaxTokens: req.MaxTokens,
		Stream:    true,
		Messages: []openAIMessage{
			{Role: "system", Content: req.SystemPrompt},
		},
	}
	if body.MaxTokens == 0 {
		body.MaxTokens = 4096
	}
	for _, m := range req.Messages {
		body.Messages = append(body.Messages, openAIMessage{Role: m.Role, Content: m.Content})
	}
	for _, t := range req.Tools {
		ot := openAITool{Type: "function"}
		ot.Function.Name = t.Name
		ot.Function.Description = t.Description
		ot.Function.Parameters = t.InputSchema
		body.Tools = append(body.Tools, ot)
	}
	// If we have tools, tell the model it may call them.
	if len(body.Tools) > 0 {
		if req.ForceToolChoice != "" {
			body.ToolChoice = req.ForceToolChoice
		} else {
			body.ToolChoice = "auto"
		}
	}

	jsonBody, _ := json.Marshal(body)
	url := strings.TrimRight(r.BaseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonBody)))
	if err != nil {
		return LLMResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+r.APIKey)

	resp, err := r.Client.Do(httpReq)
	if err != nil {
		return LLMResponse{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return LLMResponse{}, fmt.Errorf("openai-compatible (%s): %d %s", r.Model, resp.StatusCode, string(b))
	}

	// Parse SSE
	// Each line: "data: {...}" or "data: [DONE]"
	type sseChunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage *TokenUsage `json:"usage,omitempty"`
	}

	reader := bufio.NewReader(resp.Body)
	var fullText strings.Builder
	usage := TokenUsage{}
	stopReason := "stop"
	// toolCalls accumulates function/tool_calls across streamed deltas.
	// OpenAI streams the tool call as a series of deltas where each
	// delta carries an indexed fragment. We re-assemble by index.
	type toolCallAccum struct {
		ID       string
		Name     string
		ArgsJSON strings.Builder
	}
	var toolCalls []toolCallAccum
	currentToolIdx := -1

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return LLMResponse{}, err
		}
		line = strings.TrimRight(line, "\r\n")
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		// Parse with tool_calls field (OpenAI streaming format).
		var chunk sseChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue // skip malformed chunks
		}

		// Use a separate struct with tool_calls because the simple
		// sseChunk above doesn't include it.
		var raw map[string]json.RawMessage
		_ = json.Unmarshal([]byte(data), &raw)
		if rawChoices, ok := raw["choices"]; ok {
			var rawChoiceList []struct {
				Delta struct {
					Content   string          `json:"content"`
					ToolCalls []map[string]any `json:"tool_calls"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			}
			if err := json.Unmarshal(rawChoices, &rawChoiceList); err == nil {
				for _, choice := range rawChoiceList {
					if choice.FinishReason != "" {
						stopReason = choice.FinishReason
					}
					for _, tc := range choice.Delta.ToolCalls {
						// Index key — may be absent in single-tool responses.
						idx := currentToolIdx
						if v, ok := tc["index"]; ok {
							if f, ok := v.(float64); ok {
								idx = int(f)
							}
						}
						if idx < 0 || idx >= len(toolCalls) {
							// New tool call slot.
							if idx > currentToolIdx {
								currentToolIdx = idx
							}
							toolCalls = append(toolCalls, toolCallAccum{})
							idx = len(toolCalls) - 1
						}
						if v, ok := tc["id"].(string); ok && v != "" {
							toolCalls[idx].ID = v
						}
						if fn, ok := tc["function"].(map[string]any); ok {
							if name, ok := fn["name"].(string); ok && name != "" {
								toolCalls[idx].Name = name
							}
							if args, ok := fn["arguments"].(string); ok && args != "" {
								toolCalls[idx].ArgsJSON.WriteString(args)
							}
						}
					}
				}
			}
		}

		if chunk.Usage != nil {
			usage = *chunk.Usage
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				fullText.WriteString(choice.Delta.Content)
				if onDelta != nil {
					onDelta(choice.Delta.Content)
				}
			}
			if choice.FinishReason != "" {
				stopReason = choice.FinishReason
			}
		}
	}

	// Convert accumulated tool calls to the wire format.
	var responseToolCalls []ToolCall
	for i, tc := range toolCalls {
		args := tc.ArgsJSON.String()
		if args == "" {
			args = "{}"
		}
		id := tc.ID
		if id == "" {
			id = fmt.Sprintf("call_%d", i)
		}
		responseToolCalls = append(responseToolCalls, ToolCall{
			ID:    id,
			Name:  tc.Name,
			Input: json.RawMessage(args),
		})
	}

	return LLMResponse{
		Content:    fullText.String(),
		ToolCalls:  responseToolCalls,
		StopReason: stopReason,
		Usage:      usage,
	}, nil
}
