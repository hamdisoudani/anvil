package perplexity

import (
	"strings"
	"testing"
	"time"
)

// timeAfter is a small helper that returns a channel for 100ms.
func timeAfter() <-chan time.Time { return time.After(100 * time.Millisecond) }

// TestExtractJSON_PlainObject verifies the JSON extractor handles plain JSON.
func TestExtractJSON_PlainObject(t *testing.T) {
	input := `{"needs_search": true, "reason": "factual"}`
	got := extractJSON(input)
	if got != input {
		t.Errorf("expected %q, got %q", input, got)
	}
}

// TestExtractJSON_CodeFenced verifies the JSON extractor handles markdown fences.
func TestExtractJSON_CodeFenced(t *testing.T) {
	input := "```json\n{\"needs_search\": true}\n```"
	got := extractJSON(input)
	if !strings.HasPrefix(got, "{") || !strings.HasSuffix(got, "}") {
		t.Errorf("expected JSON object, got %q", got)
	}
}

// TestExtractJSON_WithProseBefore verifies it ignores prose before JSON.
func TestExtractJSON_WithProseBefore(t *testing.T) {
	input := `Here is the plan:

{"needs_search": true, "sub_queries": []}`
	got := extractJSON(input)
	if !strings.HasPrefix(got, "{") {
		t.Errorf("expected JSON object, got %q", got)
	}
}

// TestExtractJSON_NestedBraces verifies it handles nested objects.
func TestExtractJSON_NestedBraces(t *testing.T) {
	input := `before {"a": {"b": {"c": 1}}} after`
	got := extractJSON(input)
	expected := `{"a": {"b": {"c": 1}}}`
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

// TestExtractJSON_NoJSON verifies it returns "" when there's no JSON.
func TestExtractJSON_NoJSON(t *testing.T) {
	input := "no json here"
	if got := extractJSON(input); got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

// TestTopoSort_NoDeps verifies queries with no deps all go in wave 0.
func TestTopoSort_NoDeps(t *testing.T) {
	qs := []SubQuery{
		{ID: "q1", Query: "a"},
		{ID: "q2", Query: "b"},
		{ID: "q3", Query: "c"},
	}
	waves := topoSort(qs)
	if len(waves) != 1 {
		t.Fatalf("expected 1 wave, got %d", len(waves))
	}
	if len(waves[0]) != 3 {
		t.Errorf("expected 3 queries in wave 0, got %d", len(waves[0]))
	}
}

// TestTopoSort_WithDeps verifies dependent queries are placed in later waves.
func TestTopoSort_WithDeps(t *testing.T) {
	qs := []SubQuery{
		{ID: "q1", Query: "a"},
		{ID: "q2", Query: "b", DependsOn: []string{"q1"}},
		{ID: "q3", Query: "c", DependsOn: []string{"q2"}},
	}
	waves := topoSort(qs)
	if len(waves) != 3 {
		t.Fatalf("expected 3 waves, got %d", len(waves))
	}
	if waves[0][0].ID != "q1" {
		t.Errorf("wave 0 should be q1, got %s", waves[0][0].ID)
	}
	if waves[1][0].ID != "q2" {
		t.Errorf("wave 1 should be q2, got %s", waves[1][0].ID)
	}
	if waves[2][0].ID != "q3" {
		t.Errorf("wave 2 should be q3, got %s", waves[2][0].ID)
	}
}

// TestTopoSort_MixedDeps verifies mixed dep / no-dep queries are sorted correctly.
func TestTopoSort_MixedDeps(t *testing.T) {
	qs := []SubQuery{
		{ID: "q1", Query: "a"},
		{ID: "q2", Query: "b", DependsOn: []string{"q1"}},
		{ID: "q3", Query: "c"},
		{ID: "q4", Query: "d", DependsOn: []string{"q1", "q3"}},
	}
	waves := topoSort(qs)
	// Wave 0: q1, q3 (no deps)
	// Wave 1: q2 (depends on q1), q4 (depends on q1+q3)
	if len(waves) < 2 {
		t.Fatalf("expected at least 2 waves, got %d", len(waves))
	}
	if len(waves[0]) != 2 {
		t.Errorf("wave 0 should have 2 queries, got %d", len(waves[0]))
	}
}

// TestExtractCitations verifies citation extraction.
func TestExtractCitations(t *testing.T) {
	cases := []struct {
		input string
		want  map[int]bool
	}{
		{"see [1] and [2] for details", map[int]bool{1: true, 2: true}},
		{"no citations here", map[int]bool{}},
		{"multiple [1] [1] [1] same", map[int]bool{1: true}},
		{"[10] [100]", map[int]bool{10: true, 100: true}},
	}
	for _, c := range cases {
		got := extractCitations(c.input)
		if len(got) != len(c.want) {
			t.Errorf("extractCitations(%q): got %v, want %v", c.input, got, c.want)
		}
		for k := range c.want {
			if !got[k] {
				t.Errorf("extractCitations(%q): missing %d", c.input, k)
			}
		}
	}
}

// TestPickTopPages verifies page selection respects fetch_top and dedupes.
func TestPickTopPages(t *testing.T) {
	sources := []Source{
		{ID: 1, URL: "https://a.com"},
		{ID: 2, URL: "https://b.com"},
		{ID: 3, URL: "https://c.com"},
	}
	subs := []SubQuery{
		{ID: "q1", FetchTop: 2},
	}
	results := map[string][]SearchResult{
		"q1": {
			{URL: "https://a.com"},
			{URL: "https://b.com"},
			{URL: "https://c.com"},
		},
	}
	urls := pickTopPages(sources, subs, results, 10)
	if len(urls) != 2 {
		t.Errorf("expected 2 URLs, got %d: %v", len(urls), urls)
	}
}

// TestWebSearchMock verifies the mock search returns results.
func TestWebSearchMock(t *testing.T) {
	ws := &WebSearchTool{APIKey: ""}
	results, err := ws.Execute(nil, map[string]interface{}{"query": "event sourcing", "count": 5})
	if err != nil {
		t.Fatalf("mock search: %v", err)
	}
	rs, ok := results.([]SearchResult)
	if !ok {
		t.Fatalf("expected []SearchResult, got %T", results)
	}
	// Mock returns min(count, 8)
	if len(rs) < 1 || len(rs) > 8 {
		t.Errorf("expected 1-8 results, got %d", len(rs))
	}
	if rs[0].Title == "" || rs[0].URL == "" {
		t.Errorf("expected title and url, got %+v", rs[0])
	}
}

// TestSnippetsToPages verifies the fallback when all fetches fail.
func TestSnippetsToPages(t *testing.T) {
	hits := []SearchResult{
		{URL: "https://a.com", Title: "A", Snippet: "snippet A"},
		{URL: "https://b.com", Title: "B", Snippet: "snippet B"},
	}
	pages := snippetsToPages(hits, nil)
	if len(pages) != 2 {
		t.Errorf("expected 2 pages, got %d", len(pages))
	}
	if pages[0].Text != "snippet A" {
		t.Errorf("expected snippet, got %q", pages[0].Text)
	}
}

// TestStreamingBus verifies the in-process pub/sub.
func TestStreamingBus(t *testing.T) {
	bus := NewStreamingBus()
	ch := bus.Subscribe("session-1")

	bus.Publish("session-1", "thread-1", Event{Type: EventDone, Payload: map[string]interface{}{"x": 1}})

	select {
	case e := <-ch:
		if e.Type != EventDone {
			t.Errorf("expected done, got %s", e.Type)
		}
	case <-timeAfter():
		t.Fatal("timeout")
	}

	bus.Unsubscribe("session-1", ch)
	bus.Publish("session-1", "thread-1", Event{Type: EventDone, Payload: nil})
	select {
	case <-ch:
		t.Fatal("should not receive after unsubscribe")
	case <-timeAfter():
		// expected
	}
}
