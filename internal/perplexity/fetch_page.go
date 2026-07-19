package perplexity

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// FetchPageTool fetches a URL and extracts plain text.
// Strips HTML, scripts, styles. Returns the first N bytes of text.
type FetchPageTool struct {
	Client   *http.Client
	MaxBytes int
}

// NewFetchPageTool creates a fetch tool.
func NewFetchPageTool() *FetchPageTool {
	return &FetchPageTool{
		Client:   &http.Client{Timeout: 15 * time.Second},
		MaxBytes: 50_000, // ~50KB of text per page
	}
}

// Name implements the Tool interface.
func (t *FetchPageTool) Name() string { return "fetch_page" }

// Description is what the LLM sees.
func (t *FetchPageTool) Description() string {
	return "Fetch a web page and return its plain text content. Use this AFTER web_search to read the full content of a promising result. Returns title + main text + first 50KB."
}

// Schema is the JSON schema.
func (t *FetchPageTool) Schema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"url": map[string]interface{}{
				"type":        "string",
				"description": "The full URL to fetch. Must start with http:// or https://",
			},
		},
		"required": []string{"url"},
	}
}

// Execute runs the fetch.
func (t *FetchPageTool) Execute(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	url, _ := args["url"].(string)
	if url == "" {
		return nil, fmt.Errorf("fetch_page: url is required")
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return nil, fmt.Errorf("fetch_page: url must be http(s)")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Anvil/0.4; +https://github.com/hamdisoudani/anvil)")
	resp, err := t.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("fetch_page: HTTP %d for %s", resp.StatusCode, url)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(t.MaxBytes*2)))
	if err != nil {
		return nil, err
	}

	title, text := extractText(string(body))
	if len(text) > t.MaxBytes {
		text = text[:t.MaxBytes] + "..."
	}

	return PageContent{
		URL:   url,
		Title: title,
		Text:  text,
	}, nil
}

// ── HTML → text extraction (no external deps) ────────────────────

var (
	scriptRe = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	styleRe  = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	tagRe    = regexp.MustCompile(`(?s)<[^>]+>`)
	spaceRe  = regexp.MustCompile(`\s+`)
	titleRe  = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
)

func extractText(html string) (title, text string) {
	if m := titleRe.FindStringSubmatch(html); len(m) > 1 {
		title = strings.TrimSpace(m[1])
	}
	html = scriptRe.ReplaceAllString(html, " ")
	html = styleRe.ReplaceAllString(html, " ")
	html = tagRe.ReplaceAllString(html, " ")
	html = spaceRe.ReplaceAllString(html, " ")
	text = strings.TrimSpace(html)
	return
}
