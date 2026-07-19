// Perplexity clone — backend tools and agent plan.
//
// This package wires up the search engine on top of the Anvil agent engine.
// It defines:
//   - web_search tool (Brave Search API)
//   - fetch_page tool (HTTP fetch + text extraction)
//   - The "perplexity" LLM router (Claude with tool-use)
//   - The agent plan (decompose → search → fetch → synthesize → cite)
//
// The plan emits special events that the React SDK recognizes as
// frontend tools (render_sources, highlight_citation, show_related).
// These flow over the same SSE channel — no MCP, no second protocol.
package perplexity

import "context"

// SearchResult is one hit from web_search.
type SearchResult struct {
	URL     string  `json:"url"`
	Title   string  `json:"title"`
	Snippet string  `json:"snippet"`
	Score   float64 `json:"score,omitempty"`
}

// SearchTool is the interface both Brave and Tavily implement.
// Lets the orchestrator use any search backend interchangeably.
type SearchTool interface {
	Name() string
	Description() string
	Schema() map[string]interface{}
	Execute(ctx context.Context, args map[string]interface{}) (interface{}, error)
}

// PageContent is the result of fetch_page.
type PageContent struct {
	URL   string `json:"url"`
	Title string `json:"title"`
	Text  string `json:"text"`  // plain text, markdown stripped
	Links []string `json:"links,omitempty"`
}

// Source is a citation-ready source for the frontend.
// The agent collects these as it searches.
type Source struct {
	ID    int    `json:"id"`            // 1, 2, 3, ... matches [N] in the answer
	URL   string `json:"url"`
	Title string `json:"title"`
	Domain string `json:"domain"`
	Used  bool   `json:"used"`           // marked true if the agent cited it
}

// FrontendToolName is the discriminator for frontend tool calls.
// The engine emits these as tool.call events with is_frontend=true;
// the React SDK catches them and dispatches to the registered handler.
const (
	ToolRenderSources     = "render_sources"
	ToolHighlightCitation = "highlight_citation"
	ToolScrollToSource    = "scroll_to_source"
	ToolShowRelated       = "show_related"
	ToolShowSearchProgress = "show_search_progress"
	ToolShowPlanStep      = "show_plan_step"
)

// PlanStep is the structured step the agent is on.
// ThreadState.Plan is exposed in the frontend so the user can see
// "Searching the web... Reading 4 sources... Writing answer..."
type PlanStepInfo struct {
	ID     int      `json:"id"`
	Intent string   `json:"intent"`     // "search for event sourcing"
	Status string   `json:"status"`     // pending | running | done | error
	Detail string   `json:"detail,omitempty"`
}
