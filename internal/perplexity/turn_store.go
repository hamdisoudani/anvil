// Package perplexity — turn store + threaded event capture.
//
// The orchestrator (orchestrator.go) publishes events through the
// StreamingBus. The TurnStore listens to those events and, when a
// session ends (event.Type == EventDone), extracts a TurnRecord and
// stores it under its thread id.
//
// The /perplexity/thread/:id handler then reads the TurnStore to
// return full thread state — question, answer, plan, sources,
// steps, reasoning — to the client. The React SDK feeds those
// TurnRecords back through `threadToEvents` (in the canonical
// schema) to rehydrate the same view-model shapes (ChatMessage[],
// AgentState) that live streaming produces. No special-casing in
// the UI layer.
package perplexity

import (
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/hamdisoudani/anvil/internal/core/wire"
)

// turnStoreMu protects the in-memory turn map. The store is
// process-local (drops on restart). The Persistent interface is
// defined separately so production can plug in Postgres without
// changing callers.
type turnStoreMu struct {
	sync.RWMutex
	turns map[string][]wire.TurnRecord // threadID -> turns in order
}

// TurnStore is the in-memory persistence layer for completed turns.
// One TurnRecord per session (one per user question in a thread).
type TurnStore struct {
	mu sync.RWMutex
	// Per-thread ordered turn records.
	turns map[string][]wire.TurnRecord
	// Per-thread in-progress turn accumulator (one per running session).
	// Keyed by sessionID; we look up threadID via the bus.
	pending map[string]*turnAccumulator
	// bus — for threadID lookup.
	bus *StreamingBus
}

type turnAccumulator struct {
	threadID   string
	sessionID  string
	question   string
	startedAt  string
	plan       *wire.PlanObject
	steps      []wire.PlanStep
	answer     strings.Builder // captured from answer.chunk
	reasoning  strings.Builder // captured from think.chunk
	sources    []wire.AgentSource
	related    []string
	done       bool
	error      *wire.ErrorPayload
	doneReason string
}

// NewTurnStore creates a store and starts a goroutine that drains
// events from each new session. Simpler than wiring it through
// callbacks: every orchestrator emits to the bus, the bus forwards
// here.
func NewTurnStore(bus *StreamingBus) *TurnStore {
	ts := &TurnStore{
		turns:    make(map[string][]wire.TurnRecord),
		pending:  make(map[string]*turnAccumulator),
		bus:      bus,
	}
	return ts
}

// Record processes a single event from the bus. Called for every
// orchestrator event of every session. Cheap O(1) work per event;
// the heavy lifting is just appending strings.
//
// `idCounter` provides monotonic event ids when the wire event
// doesn't have one (legacy publishes without an event_id field).
func (s *TurnStore) Record(e wire.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()

	acc, ok := s.pending[e.SessionID]
	if !ok {
		// New session. Initialize accumulator from session.start.
		if e.Type != wire.EventSessionStart {
			// Skip — we only start recording from session.start.
			return
		}
		acc = &turnAccumulator{
			sessionID: e.SessionID,
			startedAt:  e.CreatedAt,
		}
		// Prefer wire.Event.ThreadID (always populated by the bus).
		// Fall back to payload fields for safety.
		acc.threadID = e.ThreadID
		if p, ok := e.Payload.(wire.SessionStartPayload); ok {
			if acc.threadID == "" {
				acc.threadID = p.ThreadID
			}
			acc.question = p.Task
		} else if m, ok := e.Payload.(map[string]interface{}); ok {
			if acc.threadID == "" {
				if tid, ok := m["threadId"].(string); ok {
					acc.threadID = tid
				} else if tid, ok := m["thread_id"].(string); ok {
					acc.threadID = tid
				}
			}
			if q, ok := m["task"].(string); ok {
				acc.question = q
			}
		}
		s.pending[e.SessionID] = acc
	}

	switch e.Type {
	case wire.EventSessionStart:
		// already initialized above
	case wire.EventPlanSet:
		if p, ok := e.Payload.(wire.PlanSetPayload); ok {
			planCopy := p.Plan
			acc.plan = &planCopy
		}
	case wire.EventPlanStep:
		if p, ok := e.Payload.(wire.PlanStepPayload); ok {
			// Replace existing step with same id (status updates),
			// otherwise append. Keep ordered by Index for stability.
			step := p.Step
			replaced := false
			for i, existing := range acc.steps {
				if existing.ID == step.ID {
					acc.steps[i] = step
					replaced = true
					break
				}
			}
			if !replaced {
				acc.steps = append(acc.steps, step)
				sort.SliceStable(acc.steps, func(i, j int) bool {
					return acc.steps[i].Index < acc.steps[j].Index
				})
			}
		}
	case wire.EventThinkChunk:
		if p, ok := e.Payload.(wire.ThinkChunkPayload); ok {
			acc.reasoning.WriteString(p.Delta)
		}
	case wire.EventAnswerChunk:
		if p, ok := e.Payload.(wire.AnswerChunkPayload); ok {
			acc.answer.WriteString(p.Delta)
		}
	case wire.EventAnswerEnd:
		if p, ok := e.Payload.(wire.AnswerEndPayload); ok && p.Text != "" {
			// Override with the final text if provided.
			acc.answer.Reset()
			acc.answer.WriteString(p.Text)
		}
	case wire.EventSourcesFound:
		if p, ok := e.Payload.(wire.SourcesFoundPayload); ok {
			// Dedup by URL — Discoverer can re-emit.
			seen := make(map[string]bool, len(acc.sources))
			merged := append([]wire.AgentSource{}, acc.sources...)
			for _, src := range merged {
				seen[src.URL] = true
			}
			for _, src := range p.Sources {
				if !seen[src.URL] {
					merged = append(merged, src)
					seen[src.URL] = true
				}
			}
			acc.sources = merged
		}
	case wire.EventError:
		if p, ok := e.Payload.(wire.ErrorPayload); ok {
			ec := p
			acc.error = &ec
		}
	case wire.EventDone:
		if p, ok := e.Payload.(wire.DonePayload); ok {
			if p.Answer != "" {
				acc.answer.Reset()
				acc.answer.WriteString(p.Answer)
			}
			if p.Sources != nil {
				acc.sources = p.Sources
			}
			if p.Related != nil {
				acc.related = p.Related
			}
			if p.Plan != nil {
				planCopy := *p.Plan
				acc.plan = &planCopy
			}
			if p.Reason != "" {
				acc.doneReason = p.Reason
			}
		} else if m, ok := e.Payload.(map[string]interface{}); ok {
			if ans, ok := m["answer"].(string); ok && ans != "" {
				acc.answer.Reset()
				acc.answer.WriteString(ans)
			}
			if srcs, ok := m["sources"].([]wire.AgentSource); ok {
				acc.sources = srcs
			}
		}
		s.flushLocked(acc)
	}
}

// flushLocked finalizes the accumulator into a TurnRecord and stores
// it under the thread id. Caller holds the mutex.
func (s *TurnStore) flushLocked(acc *turnAccumulator) {
	defer delete(s.pending, acc.sessionID)

	turn := wire.TurnRecord{
		ID:         acc.sessionID,
		ThreadID:   acc.threadID,
		SessionID:  acc.sessionID,
		Question:   acc.question,
		Answer:     acc.answer.String(),
		StartedAt:  acc.startedAt,
		EndedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Sources:    acc.sources,
		Related:    acc.related,
		Plan:       acc.plan,
		Steps:      acc.steps,
		Reasoning:  acc.reasoning.String(),
		Error:      acc.error,
		DoneReason: acc.doneReason,
	}
	s.turns[acc.threadID] = append(s.turns[acc.threadID], turn)
}

// Turns returns the persisted turns for a thread, in order. Empty
// slice for unknown threads.
func (s *TurnStore) Turns(threadID string) []wire.TurnRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]wire.TurnRecord, len(s.turns[threadID]))
	copy(out, s.turns[threadID])
	return out
}

// SessionIDs returns the session ids in a thread (chronological).
// Used by /perplexity/thread/:id for backward-compat with old
// callers.
func (s *TurnStore) SessionIDs(threadID string) []string {
	turns := s.Turns(threadID)
	ids := make([]string, len(turns))
	for i, t := range turns {
		ids[i] = t.SessionID
	}
	return ids
}
