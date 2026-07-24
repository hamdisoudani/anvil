package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
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
	LLM            LLMRouter
	WebSearch      SearchTool
	FetchPage      *FetchPageTool
	FrontendTools  []*FrontendTool // browser-side tools the LLM can invoke
}

// NewOrchestrator creates the agent.
func NewOrchestrator(llm LLMRouter, ws SearchTool, fp *FetchPageTool) *Orchestrator {
	return &Orchestrator{LLM: llm, WebSearch: ws, FetchPage: fp}
}

// WithFrontendTools attaches browser-side tools the LLM can call.
// Each tool is described to the LLM with its name + schema; the
// orchestrator emits tool.call events with is_frontend:true and
// waits for the browser to POST back a result.
func (o *Orchestrator) WithFrontendTools(tools ...*FrontendTool) *Orchestrator {
	o.FrontendTools = append(o.FrontendTools, tools...)
	return o
}

// frontendToolSpecs converts the registered FrontendTools to the
// wire-format []Tool the LLM can see.
func (o *Orchestrator) frontendToolSpecs() []Tool {
	if len(o.FrontendTools) == 0 {
		return nil
	}
	return frontendToolSpecsFrom(o.FrontendTools)
}

// frontendToolSpecsFrom converts a list of FrontendTool instances to
// []Tool specs for the LLM.
func frontendToolSpecsFrom(tools []*FrontendTool) []Tool {
	out := make([]Tool, 0, len(tools))
	for _, t := range tools {
		out = append(out, Tool{
			Name:        t.Name(),
			Description: t.Description(),
			InputSchema: t.Schema(),
		})
	}
	return out
}

// findFrontendToolIn searches a list of FrontendTool instances by name.
func findFrontendToolIn(tools []*FrontendTool, name string) *FrontendTool {
	for _, t := range tools {
		if t.Name() == name {
			return t
		}
	}
	return nil
}

// frontendToolNames returns the names of a list of FrontendTools for logging.
func frontendToolNames(tools []*FrontendTool) []string {
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = t.Name()
	}
	return names
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
	// EventToolCall / EventToolResult are emitted when the orchestrator
	// asks the browser (via the SSE stream) to run a frontend tool.
	// EventToolResult is the matching delivery the browser POSTs back.
	EventToolCall   EventType = "tool.call"
	EventToolResult EventType = "tool.result"
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

// RunOpts configures a single orchestrator run.
type RunOpts struct {
	// Prior conversation turns in this thread (user/assistant pairs).
	History []Message
	// Focus maps to preferred SourceKind: web|academic|news|reddit|youtube.
	Focus string
	// FrontendTools are browser-side tools sent by the client with the
	// task. They override any tools hardcoded on the Orchestrator.
	FrontendTools []*FrontendTool
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
// opts.History is prior thread turns; opts.Focus biases search sources.
func (o *Orchestrator) Run(ctx context.Context, question string, onEvent func(Event), opts RunOpts) (*Result, error) {
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
	plan, err := o.PlanSearch(ctx, question, opts)
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

	// Bias sources by focus mode when provided
	if opts.Focus != "" {
		applyFocus(plan, opts.Focus)
	}

	// Emit the plan to the frontend so the user sees the structure
	emit(EventFrontendCall, map[string]interface{}{
		"name":  ToolShowPlanStep,
		"input": plan,
	})

	// ── Step 1.5: Frontend tools (UI affordances) ─────────────────
	log.Printf("Step 1.5: frontend tools check, opts.FrontendTools=%d session=%d", len(opts.FrontendTools), 0)
	frontendAnswer, err := o.tryFrontendTools(ctx, question, onEvent, opts.History, opts.FrontendTools)
	log.Printf("Step 1.5: frontendAnswer=%q err=%v", frontendAnswer, err)
	if err != nil {
		// Non-fatal — log and continue with the main flow.
		emit(EventError, map[string]interface{}{
			"message": err.Error(),
			"step":    "frontend_tools",
		})
	}
	// If the frontend tool step produced a final text answer (i.e.
	// the LLM acknowledged what it did after calling the tool),
	// that IS the answer — skip search/synthesize entirely.
	if frontendAnswer != "" {
		return &Result{Answer: frontendAnswer, Sources: []Source{}, Related: []string{}}, nil
	}

	// If no search needed (chat-only), just synthesize directly
	if !plan.NeedsSearch || len(plan.SubQueries) == 0 {
		return o.synthesizeChatOnly(ctx, question, plan, onEvent, opts.History)
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
	answer, err := o.synthesize(ctx, question, sources, pages, plan.SynthesizeHint, onEvent, opts.History)
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
func (o *Orchestrator) synthesizeChatOnly(ctx context.Context, question string, plan *SearchPlan, onEvent func(Event), history []Message) (*Result, error) {
	result := &Result{Question: question, Sources: []Source{}, Related: []string{}}
	emit := func(t EventType, p map[string]interface{}) {
		if onEvent != nil {
			onEvent(Event{Type: t, Payload: p})
		}
	}
	emit(EventPlanStep, planStepPayload("generate", "Generating answer", "running", ""))
	msgs := append([]Message{}, history...)
	if len(msgs) > 12 {
		msgs = msgs[len(msgs)-12:]
	}
	msgs = append(msgs, Message{Role: "user", Content: question})
	req := LLMRequest{
		SystemPrompt: "You are a helpful research assistant. Answer the user's question directly and concisely. Use prior conversation context when relevant.",
		Messages:     msgs,
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
func (o *Orchestrator) synthesize(ctx context.Context, question string, sources []Source, pages []PageContent, hint string, onEvent func(Event), history []Message) (string, error) {
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

	msgs := append([]Message{}, history...)
	// Cap history so we don't blow the context window
	if len(msgs) > 12 {
		msgs = msgs[len(msgs)-12:]
	}
	msgs = append(msgs, Message{Role: "user", Content: sb.String()})
	req := LLMRequest{
		SystemPrompt: systemPrompt,
		Messages:     msgs,
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

// applyFocus biases sub-query Source fields to the requested focus mode.
func applyFocus(plan *SearchPlan, focus string) {
	if plan == nil {
		return
	}
	var kind SourceKind
	switch strings.ToLower(strings.TrimSpace(focus)) {
	case "academic", "scholar":
		kind = SourceAcademic
	case "news":
		kind = SourceNews
	case "reddit", "social":
		kind = SourceReddit
	case "youtube", "video":
		kind = SourceYouTube
	case "web", "":
		kind = SourceWeb
	default:
		kind = SourceWeb
	}
	for i := range plan.SubQueries {
		// Don't override if planner already set a non-web source unless focus is explicit
		if kind != SourceWeb || plan.SubQueries[i].Source == "" {
			plan.SubQueries[i].Source = kind
		}
	}
}

// tryFrontendTools gives the LLM one chance to call any registered
// frontend tool before the main agent flow continues. If the LLM
// emits a tool_call, we send a tool.call event with is_frontend:true
// over the SSE stream and BLOCK until the browser POSTs back a
// result. The LLM is then called again with the tool result and can
// either call another tool or emit a final text response.
//
// Returns the final text response (used as part of the synthesis
// context) and any error.
//
// Returns ("", nil) when no frontend tools are registered — a no-op.
func (o *Orchestrator) tryFrontendTools(
	ctx context.Context,
	question string,
	onEvent func(Event),
	history []Message,
	sessionTools []*FrontendTool,
) (string, error) {
	// Merge: session-supplied tools take priority over hardcoded ones.
	// Build a map of hardcoded tools by name, then overlay session tools.
	allTools := make([]*FrontendTool, 0, len(o.FrontendTools)+len(sessionTools))
	seen := make(map[string]bool)
	for _, t := range sessionTools {
		if !seen[t.Name()] {
			allTools = append(allTools, t)
			seen[t.Name()] = true
		}
	}
	for _, t := range o.FrontendTools {
		if !seen[t.Name()] {
			allTools = append(allTools, t)
			seen[t.Name()] = true
		}
	}
	if len(allTools) == 0 {
		return "", nil
	}

	emit := func(t EventType, p map[string]interface{}) {
		if onEvent != nil {
			onEvent(Event{Type: t, Payload: p})
		}
	}

	emit(EventPlanStep, planStepPayload("frontend_tools", "Checking for UI affordances", "running", ""))

	systemPrompt := `You are an AI assistant with access to browser-side UI tools. You MUST call one of the available tools if the user's request relates to changing, modifying, or interacting with the chat UI's appearance, focus, or layout. The available tools are: [name, description, params]. If you call a tool, you will receive the result and can decide whether to call another tool or write your final response.

Rules:
- If the user's request is about the chat UI, you MUST use a tool call. Do NOT write prose or CSS code.
- If the request is purely informational (e.g. "what's the weather"), respond with a brief one-sentence acknowledgement and stop. Do NOT call a tool.
- After a tool returns its result, you MUST tell the user exactly what you did. For example: "I've changed the background to crimson." Never claim you cannot do something you just successfully did.
- Use valid CSS color names (e.g., "crimson", "darkblue", "forestgreen") or hex codes (e.g., "#DC143C", "#03055B") for color parameters.`

	msgs := []Message{}
	// Trim history to last few exchanges (keep context manageable).
	if len(history) > 4 {
		msgs = append(msgs, history[len(history)-4:]...)
	} else {
		msgs = append(msgs, history...)
	}
	msgs = append(msgs, Message{Role: "user", Content: question})

	tools := frontendToolSpecsFrom(allTools)
	log.Printf("tryFrontendTools: tools=%d", len(tools))

	// Loop up to N rounds in case the LLM wants multiple tools.
	const maxRounds = 3
	for round := 0; round < maxRounds; round++ {
		req := LLMRequest{
			SystemPrompt: systemPrompt,
			Messages:     msgs,
			Tools:        tools,
			MaxTokens:    400,
		}
		// Round 0: force a tool decision. With "auto" the model often
				// ignores available tools and writes prose like "I can't change
				// the background, here's the hex code." For UI affordances the
				// user wants action, not an excuse. Later rounds: let it choose.
				if round == 0 {
					req.ForceToolChoice = "required"
				}
		resp, err := o.LLM.Stream(ctx, req, nil)
		if err != nil {
			emit(EventPlanStep, planStepPayload("frontend_tools", "Checking for UI affordances", "error", err.Error()))
			return "", fmt.Errorf("frontend tools LLM call: %w", err)
		}

		// If no tool calls — we have a final text answer.
		if len(resp.ToolCalls) == 0 {
			emit(EventPlanStep, planStepPayload("frontend_tools", "Checking for UI affordances", "done", "no tool call"))
			return strings.TrimSpace(resp.Content), nil
		}

		// Execute each tool call (typically just one per round).
		for _, tc := range resp.ToolCalls {
			tool := findFrontendToolIn(allTools, tc.Name)
			if tool == nil {
				// Unknown tool — emit a no-op tool.result so the
				// LLM can recover.
				emit(EventError, map[string]interface{}{
					"message": fmt.Sprintf("unknown frontend tool: %s", tc.Name),
				})
				continue
			}

			callID := MakeCallID()
			tool.RegisterCall(callID)

			// Emit the tool.call event with is_frontend:true. The
			// TS client will route it to the registered handler.
			emit(EventToolCall, map[string]interface{}{
				"id":          callID,
				"name":        tc.Name,
				"input":       tc.Input,
				"is_frontend": true,
			})

			// Block waiting for the browser to deliver the result.
			resultJSON, _, err := tool.Await(callID)
			if err != nil {
				emit(EventError, map[string]interface{}{
					"message": err.Error(),
					"tool":    tc.Name,
				})
				emit(EventToolResult, map[string]interface{}{
					"id":    callID,
					"name":  tc.Name,
					"error": err.Error(),
				})
				// Tell the LLM about the failure.
				msgs = append(msgs,
					Message{Role: "assistant", Content: ""},
					Message{Role: "user", Content: fmt.Sprintf("Tool %s failed: %s. Acknowledge briefly and stop.", tc.Name, err.Error())},
				)
				continue
			}

			// Emit the matching tool.result event so the client
					// log is consistent.
					emit(EventToolResult, map[string]interface{}{
						"id":     callID,
						"name":   tc.Name,
						"result": json.RawMessage(resultJSON),
					})

					// Feed the result back to the LLM using the proper OpenAI
					// tool-result message shape so the model connects its own
					// tool call to the result.
					msgs = append(msgs,
						Message{Role: "assistant", ToolCalls: []ToolCall{tc}},
						Message{
							Role:       "tool",
							Content:    string(resultJSON),
							ToolCallID: callID,
							Name:       tc.Name,
						},
					)
		}
	}

	emit(EventPlanStep, planStepPayload("frontend_tools", "Checking for UI affordances", "done", "max rounds"))
	return "", nil
}

// findFrontendTool returns the registered FrontendTool by name or nil.
func (o *Orchestrator) findFrontendTool(name string) *FrontendTool {
	for _, t := range o.FrontendTools {
		if t.Name() == name {
			return t
		}
	}
	return nil
}
