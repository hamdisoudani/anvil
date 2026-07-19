package perplexity

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// Orchestrator is the Perplexity-style agent.
// It takes a user question and produces a cited answer.
//
// Flow:
//   1. Search the web for the question
//   2. Fetch the top 4 results
//   3. LLM reads the pages, writes an answer with [N] citations
//   4. Extract the citations (which [N]s were used)
//   5. Generate 3 follow-up questions
//   6. Stream the answer to the frontend
//
// State lives in the ThreadState (plan, sources) and is broadcast
// via state patches. The agent loop is the one from core/agent.go;
// this is the "what should happen" layer.
type Orchestrator struct {
	LLM        LLMRouter
	WebSearch  *WebSearchTool
	FetchPage  *FetchPageTool
}

// NewOrchestrator creates the agent.
func NewOrchestrator(llm LLMRouter, ws *WebSearchTool, fp *FetchPageTool) *Orchestrator {
	return &Orchestrator{LLM: llm, WebSearch: ws, FetchPage: fp}
}

// LLMRouter is the interface we need. The engine's core.LLMRouter has a
// different signature; this is a smaller interface for our use.
type LLMRouter interface {
	Stream(ctx context.Context, req LLMRequest, onDelta func(string)) (LLMResponse, error)
}

// Plan tracks what the agent is doing. Mutated as it goes.
type Plan struct {
	Steps []PlanStepInfo
}

// Run executes the full search + answer flow.
// Returns the answer text (with [N] citations), the sources list,
// and the related questions.
//
// onEvent is called for each major event (frontend tools, plan steps).
// Pass nil for tests.
func (o *Orchestrator) Run(ctx context.Context, question string, onEvent func(eventType string, payload map[string]interface{})) (*Result, error) {
	result := &Result{Question: question, Sources: []Source{}, Related: []string{}}

	// Step 1: emit the initial plan
	if onEvent != nil {
		onEvent("plan.step", map[string]interface{}{"id": 1, "intent": "Search the web", "status": "running"})
	}
	if onEvent != nil {
		onEvent("frontend.call", map[string]interface{}{"name": ToolShowSearchProgress, "input": map[string]interface{}{"query": question}})
	}

	searchResults, err := o.WebSearch.Execute(ctx, map[string]interface{}{"query": question, "count": 8})
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	results, _ := searchResults.([]SearchResult)
	if len(results) == 0 {
		return nil, fmt.Errorf("no search results for: %s", question)
	}

	// Build sources list (numbered 1..N)
	sources := make([]Source, len(results))
	for i, r := range results {
		domain := r.URL
		if m := regexp.MustCompile(`^https?://([^/]+)/?`).FindStringSubmatch(r.URL); len(m) > 1 {
			domain = m[1]
		}
		sources[i] = Source{ID: i + 1, URL: r.URL, Title: r.Title, Domain: domain, Used: false}
	}
	result.Sources = sources

	// Emit the sources to the frontend so the sidebar populates immediately
	if onEvent != nil {
		onEvent("frontend.call", map[string]interface{}{
			"name":  ToolRenderSources,
			"input": map[string]interface{}{"sources": sources},
		})
	}

	// Step 2: fetch top 4
	if onEvent != nil {
		onEvent("plan.step", map[string]interface{}{"id": 2, "intent": "Read top sources", "status": "running"})
	}
	pages := []PageContent{}
	for i, r := range results {
		if i >= 4 {
			break
		}
		if onEvent != nil {
			onEvent("plan.step", map[string]interface{}{
				"id":     2,
				"detail": "Reading " + r.URL,
				"status": "running",
			})
		}
		page, err := o.FetchPage.Execute(ctx, map[string]interface{}{"url": r.URL})
		if err != nil {
			continue // skip failed fetches
		}
		p, _ := page.(PageContent)
		if p.Text != "" {
			pages = append(pages, p)
		}
	}
	if len(pages) == 0 {
		return nil, fmt.Errorf("could not fetch any of the search results")
	}

	// Step 3: synthesize with the LLM
	if onEvent != nil {
		onEvent("plan.step", map[string]interface{}{"id": 3, "intent": "Writing the answer", "status": "running"})
	}
	answer, err := o.synthesize(ctx, question, sources, pages, onEvent)
	if err != nil {
		return nil, fmt.Errorf("synthesize: %w", err)
	}
	result.Answer = answer

	// Step 4: extract which sources were cited
	used := extractCitations(answer)
	for i := range sources {
		if _, ok := used[sources[i].ID]; ok {
			sources[i].Used = true
		}
	}
	result.Sources = sources

	// Step 5: generate related questions
	if onEvent != nil {
		onEvent("plan.step", map[string]interface{}{"id": 4, "intent": "Generating related questions", "status": "running"})
	}
	related, err := o.relatedQuestions(ctx, question, answer)
	if err == nil {
		result.Related = related
		if onEvent != nil {
			onEvent("frontend.call", map[string]interface{}{
				"name":  ToolShowRelated,
				"input": map[string]interface{}{"questions": related},
			})
		}
	}

	// Step 6: emit done
	if onEvent != nil {
		onEvent("plan.step", map[string]interface{}{"id": 5, "intent": "Done", "status": "done"})
	}
	return result, nil
}

// Result is what Run returns.
type Result struct {
	Question string
	Answer   string
	Sources  []Source
	Related  []string
}

// synthesize asks the LLM to write the answer with [N] citations.
func (o *Orchestrator) synthesize(ctx context.Context, question string, sources []Source, pages []PageContent, onEvent func(string, map[string]interface{})) (string, error) {
	// Build the context for the LLM
	var sb strings.Builder
	sb.WriteString("Question: ")
	sb.WriteString(question)
	sb.WriteString("\n\nSources:\n")
	for _, s := range sources {
		sb.WriteString(fmt.Sprintf("[%d] %s — %s\n", s.ID, s.Title, s.URL))
	}
	sb.WriteString("\nPage contents:\n\n")
	for i, p := range pages {
		sb.WriteString(fmt.Sprintf("--- Source %d: %s ---\n", i+1, p.Title))
		sb.WriteString(p.Text)
		sb.WriteString("\n\n")
	}

	prompt := `You are a research assistant. Answer the user's question using ONLY the provided sources. Cite sources inline using [N] notation where N is the source number. Be concise but complete. If sources disagree, note the disagreement. After the answer, list all sources you cited in a "References:" line.

Example format:
The answer text with [1] and [2] inline citations.

References:
[1] Title
[2] Title`

	req := LLMRequest{
		SystemPrompt: prompt,
		Messages: []Message{
			{Role: "user", Content: sb.String()},
		},
		MaxTokens: 1500,
	}

	var delta strings.Builder
	resp, err := o.LLM.Stream(ctx, req, func(text string) {
		delta.WriteString(text)
		if onEvent != nil {
			// Stream tokens to the frontend
			onEvent("answer.chunk", map[string]interface{}{"delta": text})
		}
	})
	if err != nil {
		return "", err
	}
	_ = resp
	// Use the streamed result if available, else the response
	answer := delta.String()
	if answer == "" {
		answer = resp.Content
	}
	return answer, nil
}

// relatedQuestions generates 3 follow-up questions.
func (o *Orchestrator) relatedQuestions(ctx context.Context, question, answer string) ([]string, error) {
	prompt := `Given this Q&A, suggest 3 natural follow-up questions the user might ask. Be specific. Output one question per line, no numbering.`
	req := LLMRequest{
		SystemPrompt: prompt,
		Messages: []Message{
			{Role: "user", Content: "Q: " + question + "\nA: " + answer + "\n\nFollow-up questions:"},
		},
		MaxTokens: 200,
	}
	resp, err := o.LLM.Stream(ctx, req, nil)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(resp.Content, "\n")
	out := []string{}
	for _, l := range lines {
		l = strings.TrimSpace(l)
		l = strings.TrimPrefix(l, "- ")
		l = strings.TrimPrefix(l, "* ")
		if l != "" && strings.HasSuffix(l, "?") {
			out = append(out, l)
			if len(out) >= 3 {
				break
			}
		}
	}
	return out, nil
}

// extractCitations returns the set of [N] tags found in the answer.
func extractCitations(answer string) map[int]bool {
	found := make(map[int]bool)
	re := regexp.MustCompile(`\[(\d+)\]`)
	for _, m := range re.FindAllStringSubmatch(answer, -1) {
		if len(m) > 1 {
			var n int
			fmt.Sscanf(m[1], "%d", &n)
			if n > 0 {
				found[n] = true
			}
		}
	}
	return found
}

// ensure uuid import used
var _ = uuid.New
