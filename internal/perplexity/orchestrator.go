package perplexity

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

// CompileOnce — avoid recompiling inside hot loops.
var domainURLRe = regexp.MustCompile(`^https?://([^/]+)/?`)

// Run executes the full search + answer flow using a real search plan.
//
// New flow (Perplexity-style):
//  1. CLASSIFY + DECOMPOSE + PLAN (one LLM call): produces SearchPlan
//  2. EXECUTE PLAN: parallel searches (one per sub-query, respecting deps)
//  3. FILTER: score, dedupe, rank results
//  4. FETCH: read the top pages
//  5. SYNTHESIZE: LLM writes the answer with [N] citations
//  6. EXTRACT citations used
//  7. GENERATE follow-up questions
//
// State lives in the ThreadState (plan, sources) and is broadcast
// via state patches. The agent loop is the one from core/agent.go;
// this is the "what should happen" layer.
type Orchestrator struct {
	LLM       LLMRouter
	WebSearch SearchTool
	FetchPage *FetchPageTool
}

// NewOrchestrator creates the agent.
func NewOrchestrator(llm LLMRouter, ws SearchTool, fp *FetchPageTool) *Orchestrator {
	return &Orchestrator{LLM: llm, WebSearch: ws, FetchPage: fp}
}

// LLMRouter is the interface we need.
type LLMRouter interface {
	Stream(ctx context.Context, req LLMRequest, onDelta func(string)) (LLMResponse, error)
}

// EventType is the discriminator for the events we emit.
type EventType string

const (
	EventPlanStep     EventType = "plan.step"
	EventAnswerChunk  EventType = "answer.chunk"
	EventFrontendCall EventType = "frontend.call"
	EventSourcesFound EventType = "sources.found"
	EventError        EventType = "error"
	EventDone         EventType = "done"
	EventSessionStart EventType = "session.start"
)

// Event is what the orchestrator publishes.
type Event struct {
	Type    EventType              `json:"type"`
	Payload map[string]interface{} `json:"payload"`
}

// Plan tracks what the agent is doing. Mutated as it goes.
type Plan struct {
	Steps []PlanStepInfo
}

// Result is what Run returns.
type Result struct {
	Question string
	Answer   string
	Sources  []Source
	Related  []string
	Plan     *SearchPlan
}

// planStep is a small helper to emit a PlanStep event with string ID.
func planStepPayload(id, intent, status, detail string) map[string]interface{} {
	p := map[string]interface{}{
		"id":     id,
		"intent": intent,
		"status": status,
	}
	if detail != "" {
		p["detail"] = detail
	}
	return p
}

// Run executes the full flow.
func (o *Orchestrator) Run(ctx context.Context, question string, onEvent func(Event)) (*Result, error) {
	result := &Result{Question: question, Sources: []Source{}, Related: []string{}}

	emit := func(t EventType, p map[string]interface{}) {
		if onEvent != nil {
			onEvent(Event{Type: t, Payload: p})
		}
	}

	// NOTE: session.start is emitted by the handler (runSearch) BEFORE
	// calling Run, so it appears first in the replay buffer — letting
	// the React SDK render the user message on reload.

	// ── Step 1: PLAN ────────────────────────────────────────────────
	emit(EventPlanStep, planStepPayload("plan", "Planning the search", "running", ""))
	plan, err := o.PlanSearch(ctx, question)
	if err != nil {
		// Fall back to a single-query plan so the demo still works
		plan = &SearchPlan{
			NeedsSearch: true,
			Reason:      "planner failed, falling back to single query",
			SubQueries: []SubQuery{{
				ID: "q1", Intent: "search the question", Query: question,
				Source: SourceWeb, FetchTop: 4,
			}},
		}
	}
	emit(EventPlanStep, planStepPayload("plan", "Plan built", "done",
		fmt.Sprintf("%d sub-queries", len(plan.SubQueries))))

	// Emit the plan to the frontend so the user sees the structure
	emit(EventFrontendCall, map[string]interface{}{
		"name":  ToolShowPlanStep,
		"input": plan,
	})

	// If no search needed (chat-only), just synthesize directly
	if !plan.NeedsSearch || len(plan.SubQueries) == 0 {
		return o.synthesizeChatOnly(ctx, question, plan, onEvent)
	}

	// ── Step 2: EXECUTE (parallel) ──────────────────────────────────
	// High-level search phase marker (will be replaced by per-query steps)
	// but keep it as a summary reference.

	// Topological sort by DependsOn, then run in waves
	waves := topoSort(plan.SubQueries)
	allResults := make(map[string][]SearchResult) // by query id

	for _, wave := range waves {
		// Run all queries in this wave in parallel
		var wg sync.WaitGroup
		var mu sync.Mutex
		for _, q := range wave {
			q := q
			wg.Add(1)
			go func() {
				defer wg.Done()
				searchID := "search-" + q.ID
				emit(EventPlanStep, planStepPayload(searchID, "Searching: "+q.Intent, "running", "Query: "+q.Query))
				results, err := o.WebSearch.Execute(ctx, map[string]interface{}{
					"query": q.Query, "count": 8,
				})
				if err != nil {
					// Step-level failure only — do NOT emit session-fatal EventError.
					// Other sub-queries in the wave can still succeed.
					emit(EventPlanStep, planStepPayload(searchID, "Searching: "+q.Intent, "error",
						"Search failed: "+err.Error()))
					return
				}
				rs := []SearchResult{}
				if r, ok := results.([]SearchResult); ok {
					rs = r
				}
				emit(EventPlanStep, planStepPayload(searchID, "Searching: "+q.Intent, "done",
					fmt.Sprintf("Found %d results for: %s", len(rs), q.Query)))
				mu.Lock()
				allResults[q.ID] = rs
				mu.Unlock()
			}()
		}
		wg.Wait()
	}

	// Union, dedupe, score
	allHits := []SearchResult{}
	seen := map[string]bool{}
	for _, rs := range allResults {
		for _, r := range rs {
			if seen[r.URL] {
				continue
			}
			seen[r.URL] = true
			allHits = append(allHits, r)
		}
	}

	// Build sources list (numbered 1..N)
	sources := make([]Source, 0, len(allHits))
	for i, r := range allHits {
		domain := r.URL
		if m := domainURLRe.FindStringSubmatch(r.URL); len(m) > 1 {
			domain = m[1]
		}
		sources = append(sources, Source{
			ID:     i + 1,
			URL:    r.URL,
			Title:  r.Title,
			Domain: domain,
			Used:   false,
		})
	}
	result.Sources = sources

	// Emit the sources to the frontend
	emit(EventSourcesFound, map[string]interface{}{"sources": sources})
	emit(EventFrontendCall, map[string]interface{}{
		"name":  ToolRenderSources,
		"input": map[string]interface{}{"sources": sources},
	})

	// ── Step 3: FETCH top pages ─────────────────────────────────────

	// Decide which pages to fetch: top N from each sub-query's fetch_top
	pages := []PageContent{}
	pagesToFetch := pickTopPages(sources, plan.SubQueries, allResults, 6)
	// Parallel page fetching (independent I/O tasks)
	var fetchMu sync.Mutex
	var fetchWg sync.WaitGroup
	for fi, u := range pagesToFetch {
		url := u
		fetchID := fmt.Sprintf("fetch-%d", fi)
		emit(EventPlanStep, planStepPayload(fetchID, "Reading page", "running", url))
		fetchWg.Add(1)
		go func() {
			defer fetchWg.Done()
			page, err := o.FetchPage.Execute(ctx, map[string]interface{}{"url": url})
			if err != nil {
				emit(EventPlanStep, planStepPayload(fetchID, "Reading page", "error",
					"Failed to fetch: "+err.Error()))
				return
			}
			p, ok := page.(PageContent)
			if ok && p.Text != "" {
				emit(EventPlanStep, planStepPayload(fetchID, "Reading page", "done",
					"Read: "+p.Title))
				fetchMu.Lock()
				pages = append(pages, p)
				fetchMu.Unlock()
			} else {
				emit(EventPlanStep, planStepPayload(fetchID, "Reading page", "error",
					"No content from: "+url))
			}
		}()
	}
	fetchWg.Wait()
	if len(pages) == 0 {
		// Fall back to the search snippets if all fetches failed
		pages = snippetsToPages(allHits, sources)
	}

	// ── Step 4: SYNTHESIZE ──────────────────────────────────────────
	emit(EventPlanStep, planStepPayload("synthesize", "Writing the answer", "running", ""))
	answer, err := o.synthesize(ctx, question, sources, pages, plan.SynthesizeHint, onEvent)
	if err != nil {
		return nil, fmt.Errorf("synthesize: %w", err)
	}
	result.Answer = answer
	emit(EventPlanStep, planStepPayload("synthesize", "Writing the answer", "done",
		fmt.Sprintf("%d chars", len(answer))))

	// Mark which sources were cited
	used := extractCitations(answer)
	for i := range sources {
		if _, ok := used[sources[i].ID]; ok {
			sources[i].Used = true
		}
	}
	result.Sources = sources

	// ── Step 5: RELATED questions ───────────────────────────────────
	emit(EventPlanStep, planStepPayload("related", "Generating related questions", "running", ""))
	related, err := o.relatedQuestions(ctx, question, answer)
	if err == nil {
		result.Related = related
		emit(EventPlanStep, planStepPayload("related", "Generating related questions", "done",
			fmt.Sprintf("%d questions", len(related))))
		emit(EventFrontendCall, map[string]interface{}{
			"name":  ToolShowRelated,
			"input": map[string]interface{}{"questions": related},
		})
	} else {
		emit(EventPlanStep, planStepPayload("related", "Generating related questions", "error",
			err.Error()))
	}

	emit(EventPlanStep, planStepPayload("done", "Done", "done", ""))
	return result, nil
}

// synthesizeChatOnly handles the case where the question doesn't need search.
func (o *Orchestrator) synthesizeChatOnly(ctx context.Context, question string, plan *SearchPlan, onEvent func(Event)) (*Result, error) {
	result := &Result{Question: question, Sources: []Source{}, Related: []string{}}
	emit := func(t EventType, p map[string]interface{}) {
		if onEvent != nil {
			onEvent(Event{Type: t, Payload: p})
		}
	}
	emit(EventPlanStep, planStepPayload("generate", "Generating answer", "running", ""))
	req := LLMRequest{
		SystemPrompt: "You are a helpful research assistant. Answer the user's question directly and concisely.",
		Messages:     []Message{{Role: "user", Content: question}},
		MaxTokens:    1500,
	}
	var delta strings.Builder
	resp, err := o.LLM.Stream(ctx, req, func(text string) {
		delta.WriteString(text)
		emit(EventAnswerChunk, map[string]interface{}{"delta": text})
	})
	if err != nil {
		return nil, err
	}
	answer := delta.String()
	if answer == "" {
		answer = resp.Content
	}
	result.Answer = answer
	emit(EventPlanStep, planStepPayload("generate", "Generating answer", "done", fmt.Sprintf("%d chars", len(answer))))
	emit(EventPlanStep, planStepPayload("done", "Done", "done", ""))
	return result, nil
}

// synthesize asks the LLM to write the answer with [N] citations.
func (o *Orchestrator) synthesize(ctx context.Context, question string, sources []Source, pages []PageContent, hint string, onEvent func(Event)) (string, error) {
	emit := func(t EventType, p map[string]interface{}) {
		if onEvent != nil {
			onEvent(Event{Type: t, Payload: p})
		}
	}

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

	systemPrompt := `You are a research assistant. Answer the user's question using ONLY the provided sources. Cite sources inline using [N] notation. Be concise but complete. If sources disagree, note the disagreement.`
	if hint != "" {
		systemPrompt += "\n\nStyle guidance: " + hint
	}

	req := LLMRequest{
		SystemPrompt: systemPrompt,
		Messages:     []Message{{Role: "user", Content: sb.String()}},
		MaxTokens:    2000,
	}

	var delta strings.Builder
	resp, err := o.LLM.Stream(ctx, req, func(text string) {
		delta.WriteString(text)
		emit(EventAnswerChunk, map[string]interface{}{"delta": text})
	})
	if err != nil {
		return "", err
	}
	_ = resp
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

// topoSort groups sub-queries into "waves" by their dependencies.
// All queries in the same wave can run in parallel.
// Queries with no dependencies are in wave 0.
func topoSort(queries []SubQuery) [][]SubQuery {
	byID := make(map[string]SubQuery)
	for _, q := range queries {
		byID[q.ID] = q
	}
	waves := [][]SubQuery{}
	placed := make(map[string]bool)
	for len(placed) < len(queries) {
		wave := []SubQuery{}
		for _, q := range queries {
			if placed[q.ID] {
				continue
			}
			// All deps must be placed
			ok := true
			for _, dep := range q.DependsOn {
				if !placed[dep] {
					ok = false
					break
				}
			}
			if ok {
				wave = append(wave, q)
			}
		}
		if len(wave) == 0 {
			// Cycle or unknown dep — just put the remaining ones in
			for _, q := range queries {
				if !placed[q.ID] {
					wave = append(wave, q)
					break
				}
			}
		}
		for _, q := range wave {
			placed[q.ID] = true
		}
		waves = append(waves, wave)
	}
	return waves
}

// pickTopPages selects which URLs to actually fetch.
// For each sub-query, take the top fetch_top results. Dedup.
func pickTopPages(sources []Source, subQueries []SubQuery, resultsByID map[string][]SearchResult, maxTotal int) []string {
	seen := map[string]bool{}
	urls := []string{}
	// For each sub-query, prefer its own results
	for _, q := range subQueries {
		rs := resultsByByID(resultsByID, q.ID)
		for i, r := range rs {
			if i >= q.FetchTop {
				break
			}
			if seen[r.URL] {
				continue
			}
			seen[r.URL] = true
			urls = append(urls, r.URL)
			if len(urls) >= maxTotal {
				return urls
			}
		}
	}
	return urls
}

// resultsByByID is a small helper that handles nil maps.
func resultsByByID(m map[string][]SearchResult, id string) []SearchResult {
	if m == nil {
		return nil
	}
	return m[id]
}

// snippetsToPages is a fallback when all fetches fail — use the search snippets.
func snippetsToPages(hits []SearchResult, sources []Source) []PageContent {
	out := make([]PageContent, 0, len(hits))
	for i, h := range hits {
		if i >= 4 {
			break
		}
		out = append(out, PageContent{
			URL:   h.URL,
			Title: h.Title,
			Text:  h.Snippet,
		})
	}
	return out
}
