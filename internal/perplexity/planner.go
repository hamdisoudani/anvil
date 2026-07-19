package perplexity

// Search planner — the part Perplexity does well that we currently skip.
//
// Flow:
//   1. CLASSIFY: Does this question need search? Or is it a chat-only question
//      ("write me a poem", "explain recursion to me") that doesn't need web?
//   2. DECOMPOSE: For complex questions, split into 2-4 sub-questions.
//   3. PLAN: For each sub-question, decide:
//        - which source (web / academic / reddit / news / youtube)
//        - what search query
//        - year qualifier
//        - whether to fetch the page or just read the snippet
//   4. ORDER: Independent sub-questions run in parallel. Dependent ones
//      (e.g. "what is X" → "X vs Y") run sequentially.
//
// The plan is then executed by parallel sub-agents (one per sub-question)
// via goroutines + the SubAgentCoord. The results are unioned, scored,
// and the top N pages are fetched. Then the LLM synthesizes.
//
// This is the pattern that makes Perplexity's answers feel thorough:
// they don't just search once, they search 4-5 different angles.

// SearchPlan is the output of the planner.
type SearchPlan struct {
	// NeedsSearch is true if the question needs web search at all.
	// (False for "write me a haiku about X" — pure generation.)
	NeedsSearch bool `json:"needs_search"`

	// Reason explains why this plan was chosen.
	Reason string `json:"reason"`

	// SubQueries are the decomposed search tasks.
	SubQueries []SubQuery `json:"sub_queries"`

	// SynthesizeHint is what the LLM is told to do with the results.
	// e.g. "Write a comparative answer that highlights differences"
	SynthesizeHint string `json:"synthesize_hint,omitempty"`
}

// SubQuery is one search task within a plan.
type SubQuery struct {
	ID     string   `json:"id"`
	Intent string   `json:"intent"`     // "what is event sourcing"
	Query  string   `json:"query"`      // "what is event sourcing pattern 2025"
	Source SourceKind `json:"source"`   // web | academic | news | reddit | youtube
	Year   int      `json:"year,omitempty"` // prefer results from this year
	FetchTop int    `json:"fetch_top"`  // how many pages to actually read (default 2)
	DependsOn []string `json:"depends_on,omitempty"` // IDs that must complete first
}

// SourceKind is where to search.
type SourceKind string

const (
	SourceWeb     SourceKind = "web"
	SourceAcademic SourceKind = "academic"
	SourceNews    SourceKind = "news"
	SourceReddit  SourceKind = "reddit"
	SourceYouTube SourceKind = "youtube"
)
