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
//   OPENAI_API_KEY  →  Bearer token
//   OPENAI_BASE_URL →  e.g. "https://integrate.api.nvidia.com/v1"
//   OPENAI_MODEL    →  e.g. "meta/llama-3.1-70b-instruct"
type OpenAICompatibleRouter struct {
	APIKey  string
	BaseURL string
	Model   string
	Client  *http.Client
}

// NewOpenAICompatibleRouter creates the router from env vars.
// Defaults to NVIDIA NIM with Llama 3.1 70B (fast, smart, free tier).
func NewOpenAICompatibleRouter() *OpenAICompatibleRouter {
	base := os.Getenv("OPENAI_BASE_URL")
	if base == "" {
		base = "https://integrate.api.nvidia.com/v1"
	}
	model := os.Getenv("OPENAI_MODEL")
	if model == "" {
		model = "meta/llama-3.1-70b-instruct"
	}
	return &OpenAICompatibleRouter{
		APIKey:  os.Getenv("OPENAI_API_KEY"),
		BaseURL: base,
		Model:   model,
		Client:  &http.Client{Timeout: 120 * time.Second},
	}
}

// Name implements the LLMRouter interface.
func (r *OpenAICompatibleRouter) Name() string { return "openai-compatible" }

// openAIRequest is the wire format the OpenAI API expects.
// Uses messages array format (no top-level 'system' field) for
// maximum compatibility — Groq, Together, vLLM, and others
// don't support the non-standard 'system' field.
type openAIRequest struct {
	Model     string          `json:"model"`
	MaxTokens int             `json:"max_tokens,omitempty"`
	Stream    bool            `json:"stream"`
	Messages  []openAIMessage `json:"messages"`
	Tools     []openAITool    `json:"tools,omitempty"`
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

	jsonBody, _ := json.Marshal(body)
	url := strings.TrimRight(r.BaseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonBody)))
	if err != nil {
		return LLMResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+r.APIKey)
	if strings.Contains(r.BaseURL, "nvidia") {
		// NVIDIA NIM uses a different auth header convention
		httpReq.Header.Set("Authorization", "Bearer "+r.APIKey)
	}

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
		var chunk sseChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue // skip malformed chunks
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
		}
	}

	return LLMResponse{
		Content:    fullText.String(),
		StopReason: "stop",
		Usage:      usage,
	}, nil
}
