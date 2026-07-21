package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// PlanSearch asks the LLM to build a search plan for the question.
// Returns a SearchPlan with the decomposed sub-queries.
//
// This is one LLM call. It must be fast (Haiku, ~500ms).
func (o *Orchestrator) PlanSearch(ctx context.Context, question string, opts RunOpts) (*SearchPlan, error) {
	currentYear := time.Now().Year()
	focusHint := ""
	if opts.Focus != "" {
		focusHint = fmt.Sprintf("\nPreferred source focus: %s — bias sub_queries.source toward this when relevant.", opts.Focus)
	}
	historyHint := ""
	if len(opts.History) > 0 {
		var hb strings.Builder
		hb.WriteString("\n\nPrior conversation (use for context; do not re-search facts already answered unless user asks for updates):\n")
		start := 0
		if len(opts.History) > 8 {
			start = len(opts.History) - 8
		}
		for _, m := range opts.History[start:] {
			hb.WriteString(m.Role)
			hb.WriteString(": ")
			// Truncate long turns
			c := m.Content
			if len(c) > 400 {
				c = c[:400] + "…"
			}
			hb.WriteString(c)
			hb.WriteString("\n")
		}
		historyHint = hb.String()
	}
	prompt := fmt.Sprintf(`You are a research planner. Given a user's question, decide if it needs web search and how to decompose it.

Current year: %d%s%s

Return a JSON object with this schema:
{
  "needs_search": true | false,
  "reason": "<one sentence: why search or why not>",
  "sub_queries": [
    {
      "id": "q1",
      "intent": "<what this query is trying to find>",
      "query": "<the actual search query string>",
      "source": "web" | "academic" | "news" | "reddit" | "youtube",
      "year": <preferred year or 0 for any>,
      "fetch_top": <how many pages to read (1-3)>,
      "depends_on": ["q1", "q2"]  // IDs of queries that must run first
    }
  ],
  "synthesize_hint": "<how to structure the final answer>"
}

Rules:
- needs_search=false ONLY for pure generation (write a poem, code from scratch, explain a concept I gave you) OR when prior conversation already fully answers and user is just refining style.
- For factual questions about the world, current events, or specific products, needs_search=true.
- Decompose complex questions into 2-4 independent sub-queries.
- Each sub-query should be specific and add a year qualifier for time-sensitive topics.
- Mark queries as dependent only if the answer to one truly requires the other.
- For "compare X vs Y", use TWO sub-queries: one for X, one for Y, then a third that synthesizes.
- If this is a follow-up, bias queries toward what is NEW relative to prior turns.

Output ONLY the JSON. No prose.`, currentYear, focusHint, historyHint)

	req := LLMRequest{
		SystemPrompt: prompt,
		Messages: []Message{
			{Role: "user", Content: "Question: " + question},
		},
		MaxTokens: 1000,
	}

	resp, err := o.LLM.Stream(ctx, req, nil)
	if err != nil {
		return nil, err
	}

	// Extract the JSON from the response (LLMs sometimes wrap in ```json)
	jsonText := extractJSON(resp.Content)
	if jsonText == "" {
		return nil, fmt.Errorf("planner: no JSON in response: %s", resp.Content)
	}

	var plan SearchPlan
	if err := json.Unmarshal([]byte(jsonText), &plan); err != nil {
		return nil, fmt.Errorf("planner: parse JSON: %w\nraw: %s", err, jsonText)
	}

	// Defaults
	if plan.SubQueries == nil {
		plan.SubQueries = []SubQuery{}
	}
	for i := range plan.SubQueries {
		if plan.SubQueries[i].FetchTop == 0 {
			plan.SubQueries[i].FetchTop = 2
		}
		if plan.SubQueries[i].Source == "" {
			plan.SubQueries[i].Source = SourceWeb
		}
	}
	return &plan, nil
}

// extractJSON finds the JSON object in the LLM output.
// Handles both {"...":...} and ```json\n{...}\n``` formats.
// Tracks string contexts to avoid counting braces inside string values.
func extractJSON(s string) string {
	s = strings.TrimSpace(s)
	// Strip markdown code fences
	if strings.HasPrefix(s, "```") {
		re := regexp.MustCompile("(?s)```(?:json)?\\s*(\\{.*?\\})\\s*```")
		if m := re.FindStringSubmatch(s); len(m) > 1 {
			return m[1]
		}
	}
	// Find the first { ... } that looks like JSON
	start := strings.Index(s, "{")
	if start < 0 {
		return ""
	}
	depth := 0
	inStr := false
	escaped := false
	for i := start; i < len(s); i++ {
		c := s[i]
		if inStr {
			if escaped {
				escaped = false
				continue
			}
			if c == '\\' {
				escaped = true
				continue
			}
			if c == '"' {
				inStr = false
			}
			continue
		}
		switch c {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		case '"':
			inStr = true
		}
	}
	return ""
}
