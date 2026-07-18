package core

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

// ContextManager packs the LLM context window.
//
// 4-tier packing:
//   1. System (~2k)    — fixed, cached
//   2. Tools (~5k)     — fixed, cached
//   3. Scratchpad (~8k) — current plan
//   4. Recent (~40k)   — last 20 turns
//   5. Summary (~5k)   — compressed older history
//   6. RAG (~20k)      — relevant older events
//   7. Headroom        — rest for response
//
// Total target: 200k tokens for Claude. We aim for 80k of input, 120k for
// the model's response, so it can think hard when it needs to.
type ContextManager struct {
	mu         sync.Mutex
	maxTokens  int
	sysPrompt  string
	cacheKey   string
}

func NewContextManager(maxTokens int) *ContextManager {
	return &ContextManager{
		maxTokens: maxTokens,
		sysPrompt: defaultSystemPrompt,
	}
}

func (cm *ContextManager) SystemPrompt() string { return cm.sysPrompt }

func (cm *ContextManager) CacheKey() string {
	if cm.cacheKey != "" {
		return cm.cacheKey
	}
	h := sha256.Sum256([]byte(cm.sysPrompt))
	cm.cacheKey = hex.EncodeToString(h[:8])
	return cm.cacheKey
}

// Pack returns the messages in the order they should appear in the LLM call.
func (cm *ContextManager) Pack(s State) []Message {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Pre-allocate capacity: system (3) + recent (up to 20) + 1 long-term.
	// Avoids repeated slice growth on every step.
	out := make([]Message, 0, 4+20)

	out = append(out, Message{Role: "system", Content: cm.sysPrompt})

	// Scratchpad = current plan as a system message so it stays top-of-mind
	if plan := formatPlan(s.Plan); plan != "" {
		out = append(out, Message{Role: "system", Content: "Current plan:\n" + plan})
	}
	if scratch, ok := s.Scratchpad["last_observation"]; ok {
		// json.Marshal of the observation is bounded — we cap at 8KB.
		if b, _ := json.Marshal(scratch); len(b) < 8000 {
			out = append(out, Message{Role: "system", Content: "Last observation: " + string(b)})
		}
	}

	// Recent history (last 20). Slicing an existing slice is O(1).
	recent := s.History
	if len(recent) > 20 {
		recent = recent[len(recent)-20:]
	}
	out = append(out, recent...)

	// Long-term summary (older history, compressed)
	if s.LongTerm != "" {
		out = append(out, Message{Role: "system", Content: "Summary of earlier conversation:\n" + s.LongTerm})
	}

	return out
}

// MaybeSummarize is called every K steps. If the history has grown past the
// threshold, compress older turns into a summary and trim history.
//
// This is the lazy summarization pattern. Don't summarize on every step —
// it's expensive and rarely needed. Every 20-50 steps is enough.
func (cm *ContextManager) MaybeSummarize(s *State) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if len(s.History) < 40 {
		return  // not enough history to bother
	}

	// Estimate token cost (rough: 4 chars per token)
	estTokens := 0
	for _, m := range s.History {
		estTokens += len(m.Content) / 4
	}
	if estTokens < 60_000 {
		return  // fits comfortably, no need
	}

	// Compress oldest 30 turns into the long-term summary
	old := s.History[:30]
	cm.summarizeInto(s, old)

	// Keep recent in history
	s.History = s.History[30:]
}

// summarizeInto folds the oldest turns into the running summary. Real impl
// would call the LLM with a "compress this" prompt. Stub for now.
func (cm *ContextManager) summarizeInto(s *State, old []Message) {
	// Real implementation: call router with "summarize this conversation" prompt
	// and append the result to s.LongTerm.
	//
	// For now, a simple concat fallback so the structure works.
	var add string
	for _, m := range old {
		add += fmt.Sprintf("%s: %s\n", m.Role, m.Content)
	}
	if s.LongTerm == "" {
		s.LongTerm = add
	} else {
		s.LongTerm = s.LongTerm + "\n---\n" + add
	}
	// Cap at 5k chars to avoid blowing the budget
	if len(s.LongTerm) > 5000 {
		s.LongTerm = s.LongTerm[len(s.LongTerm)-5000:]
	}
}

func formatPlan(plan []PlanStep) string {
	if len(plan) == 0 {
		return ""
	}
	b, _ := json.MarshalIndent(plan, "", "  ")
	return string(b)
}

const defaultSystemPrompt = `You are an autonomous agent working on a task given by a user.

You work step by step. Each step you either:
  - Call a tool to gather information or take an action
  - Produce a final answer when the task is complete

You have a scratchpad (current plan), a short history (recent turns), and a
long-term summary (compressed older context). Use them. Do not redo work
that's already been recorded.

When you call a tool, be specific about arguments. When you finish, the
final text is shown to the user as the answer.`
