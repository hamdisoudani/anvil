package core

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

// RunRecord is the canonical record of one step in an agent run.
// Every plugin writes here. The unified record is what makes
// anvil replay / anvil inspect / cost analysis / observability
// work across patterns (LangGraph-style, CrewAI-style, etc).
//
// Defined in core (not plugin) so the engine can write it without
// creating an import cycle.
type RunRecord struct {
	ThreadID    string                 `json:"thread_id"`
	Step        int                    `json:"step"`
	StateRef    string                 `json:"state_ref"`
	Action      Action                 `json:"action"`
	Observation map[string]interface{} `json:"observation,omitempty"`
	Cost        float64                `json:"cost_usd"`
	Tokens      TokenUsage             `json:"tokens"`
	Latency     time.Duration          `json:"latency"`
	PluginName  string                 `json:"plugin_name"`
	Timestamp   time.Time              `json:"timestamp"`
}

// RunRecordStore is where every step of an agent run is persisted.
type RunRecordStore interface {
	Append(rec RunRecord) (int64, error)
	List(threadID string, since int) ([]RunRecord, error)
}

// InMemoryRunRecordStore is the default — for tests.
type InMemoryRunRecordStore struct {
	mu      sync.RWMutex
	records []RunRecord
	counter int64
}

func NewInMemoryRunRecordStore() *InMemoryRunRecordStore {
	return &InMemoryRunRecordStore{}
}

func (s *InMemoryRunRecordStore) Append(rec RunRecord) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counter++
	rec.Timestamp = time.Now()
	s.records = append(s.records, rec)
	return s.counter, nil
}

func (s *InMemoryRunRecordStore) List(threadID string, since int) ([]RunRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []RunRecord
	for _, r := range s.records {
		if r.ThreadID == threadID && r.Step >= since {
			out = append(out, r)
		}
	}
	return out, nil
}

// recordStep builds and persists a RunRecord for the current step.
// This is what the architect critic identified as missing — the
// canonical record that makes "anvil replay" and "anvil inspect"
// possible, not just claims in a design doc.
//
// RunRecord lives in core (not plugin) so the engine can write
// without creating an import cycle.
func (s *Session) recordStep(action Action, observation interface{}, duration time.Duration) {
	if s.recordStore == nil {
		return
	}
	rec := RunRecord{
		ThreadID: s.State.SessionID.String(),
		Step:     s.State.Step,
		StateRef: "ckpt-" + uuid.NewString()[:8],
		Action:   action,
		Observation: map[string]interface{}{
			"data": observation,
		},
		Cost:       estimateCost(action.Usage),
		Tokens:     action.Usage,
		Latency:    duration,
		PluginName: "core",
	}
	if s.router != nil {
		rec.PluginName = "router"
	}
	s.recordStore.Append(rec)
}

// estimateCost returns a rough USD cost from token usage.
// Real impl would use the model's pricing table.
func estimateCost(usage TokenUsage) float64 {
	// Rough: $3/M input, $15/M output for sonnet-class
	return float64(usage.InputTokens)*0.000003 + float64(usage.OutputTokens)*0.000015
}
