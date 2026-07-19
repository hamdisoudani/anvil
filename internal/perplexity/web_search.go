package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// WebSearchTool searches the web via the Brave Search API.
// Falls back to a mock implementation if no API key is set
// (so the engine can be demoed without external dependencies).
type WebSearchTool struct {
	APIKey string
	Client *http.Client
}

// NewWebSearchTool creates a web search tool.
// BRAVE_API_KEY env var is the API key; if empty, returns mock results.
func NewWebSearchTool() *WebSearchTool {
	return &WebSearchTool{
		APIKey: os.Getenv("BRAVE_API_KEY"),
		Client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Name implements the Tool interface.
func (t *WebSearchTool) Name() string { return "web_search" }

// Description is what the LLM sees.
func (t *WebSearchTool) Description() string {
	return "Search the web for a query. Returns up to 10 results with URL, title, and snippet. Use this whenever you need current information or to verify a claim."
}

// Schema is the JSON schema for the LLM.
func (t *WebSearchTool) Schema() map[string]interface{} {
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
		},
		"required": []string{"query"},
	}
}

// Execute runs the search.
func (t *WebSearchTool) Execute(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	query, _ := args["query"].(string)
	if query == "" {
		return nil, fmt.Errorf("web_search: query is required")
	}
	count, _ := args["count"].(float64)
	if count == 0 {
		count = 8
	}

	if t.APIKey == "" {
		// Mock mode — return plausible results so the demo works.
		return t.mockSearch(query, int(count)), nil
	}

	// Real Brave API
	return t.braveSearch(ctx, query, int(count))
}

type braveResponse struct {
	Web struct {
		Results []struct {
			URL     string `json:"url"`
			Title   string `json:"title"`
			Snippet string `json:"description"`
		} `json:"results"`
	} `json:"web"`
}

func (t *WebSearchTool) braveSearch(ctx context.Context, query string, count int) ([]SearchResult, error) {
	u := "https://api.search.brave.com/res/v1/web/search?q=" + url.QueryEscape(query) + "&count=" + fmt.Sprint(count)
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", t.APIKey)

	resp, err := t.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("brave search: %d %s", resp.StatusCode, string(body))
	}

	var br braveResponse
	if err := json.Unmarshal(body, &br); err != nil {
		return nil, err
	}

	results := make([]SearchResult, len(br.Web.Results))
	for i, r := range br.Web.Results {
		results[i] = SearchResult{URL: r.URL, Title: r.Title, Snippet: r.Snippet}
	}
	return results, nil
}

// mockSearch returns plausible-looking results for demos.
// NOT for production — set BRAVE_API_KEY to use the real API.
func (t *WebSearchTool) mockSearch(query string, count int) []SearchResult {
	mock := []SearchResult{
		{
			URL:     "https://en.wikipedia.org/wiki/" + url.PathEscape(strings.ReplaceAll(query, " ", "_")),
			Title:   strings.Title(query) + " — Wikipedia",
			Snippet: "Wikipedia article covering " + query + ". Includes history, definitions, and references.",
		},
		{
			URL:     "https://martinfowler.com/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   strings.Title(query) + " — Martin Fowler",
			Snippet: "Martin Fowler's patterns and practices entry on " + query + ".",
		},
		{
			URL:     "https://aws.amazon.com/what-is/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   "What is " + strings.Title(query) + "? — AWS",
			Snippet: "AWS overview article on " + query + " with examples and diagrams.",
		},
		{
			URL:     "https://www.confluent.io/learn/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   strings.Title(query) + " — Confluent",
			Snippet: "Confluent's take on " + query + " with code samples and architecture diagrams.",
		},
		{
			URL:     "https://www.geeksforgeeks.org/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   strings.Title(query) + " — GeeksforGeeks",
			Snippet: "Tutorial-style coverage of " + query + " with examples.",
		},
		{
			URL:     "https://stackoverflow.com/questions/tagged/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   strings.Title(query) + " — Stack Overflow",
			Snippet: "Q&A from developers about " + query + ".",
		},
		{
			URL:     "https://arxiv.org/abs/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   strings.Title(query) + " — arXiv",
			Snippet: "Academic paper on " + query + ".",
		},
		{
			URL:     "https://github.com/topics/" + url.PathEscape(strings.ReplaceAll(strings.ToLower(query), " ", "-")),
			Title:   strings.Title(query) + " — GitHub Topics",
			Snippet: "Open source projects related to " + query + ".",
		},
	}
	if count < len(mock) {
		return mock[:count]
	}
	return mock
}
