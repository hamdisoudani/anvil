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
)

// TavilySearchTool searches the web via the Tavily Search API.
// Tavily is designed for AI agents — it returns clean, LLM-ready
// content with relevance scores. Used by Perplexity, Manus, Cursor, etc.
//
// Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
// Auth: Bearer token via TAVILY_API_KEY env var.
type TavilySearchTool struct {
	APIKey string
	Client *http.Client
}

// NewTavilySearchTool creates the tool. Reads TAVILY_API_KEY from env.
// If the key is empty, returns a tool that errors on Execute (so the
// server can still start, but the agent fails clearly).
func NewTavilySearchTool() *TavilySearchTool {
	return &TavilySearchTool{
		APIKey: os.Getenv("TAVILY_API_KEY"),
		Client: &http.Client{Timeout: 30 * time.Second},
	}
}

// Name implements the Tool interface.
func (t *TavilySearchTool) Name() string { return "web_search" }

// Description is what the LLM sees.
func (t *TavilySearchTool) Description() string {
	return "Search the web for a query. Returns up to 10 results with URL, title, snippet, and LLM-ready content. Use this whenever you need current information or to verify a claim."
}

// Schema is the JSON schema for the LLM.
func (t *TavilySearchTool) Schema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query": map[string]interface{}{
				"type":        "string",
				"description": "The search query. Be specific.",
			},
			"count": map[string]interface{}{
				"type":        "integer",
				"description": "How many results to return (default 8, max 20).",
				"default":     8,
			},
			"topic": map[string]interface{}{
				"type":        "string",
				"enum":        []string{"general", "news", "finance"},
				"description": "Category of search. Default: general.",
				"default":     "general",
			},
		},
		"required": []string{"query"},
	}
}

// tavilyResponse is the wire format Tavily returns.
type tavilyResponse struct {
	Query   string `json:"query"`
	Results []struct {
		Title   string  `json:"title"`
		URL     string  `json:"url"`
		Content string  `json:"content"`
		Score   float64 `json:"score"`
	} `json:"results"`
	Answer   string   `json:"answer,omitempty"`
	FollowUp []string `json:"follow_up_questions,omitempty"`
}

// Execute runs the search.
func (t *TavilySearchTool) Execute(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	if t.APIKey == "" {
		return nil, fmt.Errorf("tavily: TAVILY_API_KEY not set")
	}

	query, _ := args["query"].(string)
	if query == "" {
		return nil, fmt.Errorf("web_search: query is required")
	}
	count := 8
	if v, ok := args["count"].(float64); ok && v > 0 {
		count = int(v)
		if count > 20 {
			count = 20
		}
	}
	topic := "general"
	if v, ok := args["topic"].(string); ok && v != "" {
		topic = v
	}

	body := map[string]interface{}{
		"query":               query,
		"max_results":         count,
		"topic":               topic,
		"include_raw_content": false, // keep response small
		"include_answer":      true,  // Tavily synthesizes a short answer
	}
	bodyJSON, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, "POST",
		"https://api.tavily.com/search", strings.NewReader(string(bodyJSON)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.APIKey)

	resp, err := t.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("tavily: %d %s", resp.StatusCode, string(respBody))
	}

	var tr tavilyResponse
	if err := json.Unmarshal(respBody, &tr); err != nil {
		return nil, fmt.Errorf("tavily: parse: %w", err)
	}

	results := make([]SearchResult, len(tr.Results))
	for i, r := range tr.Results {
		// Content is a short snippet (1-3 sentences) — perfect for the LLM
		// to cite. The full page text comes from fetch_page.
		snippet := r.Content
		if len(snippet) > 300 {
			snippet = snippet[:300] + "..."
		}
		results[i] = SearchResult{
			URL:     r.URL,
			Title:   r.Title,
			Snippet: snippet,
			Score:   r.Score,
		}
	}
	return results, nil
}
