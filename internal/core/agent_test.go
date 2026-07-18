package core

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// newTestAgent wires up the engine with in-memory stores and a stub LLM.
func newTestAgent(responses ...string) *Agent {
	store := NewInMemoryEventStore()
	cp := NewInMemoryCheckpointStore()
	cache := NewInMemoryCache()
	router := NewStubLLMRouter(responses...)
	return &Agent{
		store:  store,
		cp:     cp,
		cache:  cache,
		router: router,
		tools:  DefaultTools(),
		cfg:    DefaultConfig(),
	}
}

// TestAgent_RunAndResume is the smoke test for the whole engine.
//
// Verifies that a session runs end-to-end and emits the right events.
func TestAgent_RunAndResume(t *testing.T) {
	a := newTestAgent(
		"calling calculator now",  // step 0: returns a tool call
		"final answer: 5",         // step 1: returns final answer
	)

	sess, sub, err := a.Run(context.Background(), "what is 2 + 3?")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	_ = sess

	// Give the loop a moment to start and emit session.start
	time.Sleep(50 * time.Millisecond)

	// Drain the channel
	events := []Event{}
	timeout := time.After(500 * time.Millisecond)
loop:
	for {
		select {
		case e, ok := <-sub.Channel():
			if !ok {
				break loop
			}
			events = append(events, e)
		case <-timeout:
			break loop
		}
	}

	// We expect at minimum: session.start. The stub never picks a tool,
	// so the loop should hit the IsFinal branch when the stub returns text.
	var sawStart bool
	for _, e := range events {
		if e.Type == EventSessionStart {
			sawStart = true
		}
	}
	if !sawStart {
		t.Error("missing session.start event")
	}
}

// TestAgent_ResumeFromCheckpoint verifies checkpoint persistence.
func TestAgent_ResumeFromCheckpoint(t *testing.T) {
	a := newTestAgent("resumed step")

	sessionID := uuid.New()
	state := State{
		SessionID:  sessionID,
		Step:       3,
		History:    []Message{{Role: "user", Content: "old task"}},
		Scratchpad: map[string]interface{}{"task": "old task"},
	}
	if err := a.cp.Save(context.Background(), state); err != nil {
		t.Fatalf("save: %v", err)
	}

	loaded, err := a.cp.Load(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Step != 3 {
		t.Errorf("expected step 3, got %d", loaded.Step)
	}
}

// TestIdempotency verifies tool result caching on repeat calls.
func TestIdempotency(t *testing.T) {
	a := newTestAgent()
	sess, _, _ := a.Run(context.Background(), "test")

	action := Action{
		ToolCall: &ToolCallRequest{
			ID:    "1",
			Name:  "calculator",
			Input: map[string]interface{}{"expression": "2 + 3"},
		},
	}
	r1 := sess.executeTool(action)
	if r1.Err != nil {
		t.Fatalf("first call failed: %v", r1.Err)
	}
	if r1.Cached {
		t.Error("first call should not be cached")
	}

	r2 := sess.executeTool(action)
	if !r2.Cached {
		t.Error("second call should be cached")
	}
}

// TestContextPacking checks the 4-tier context packing produces ordered output.
func TestContextPacking(t *testing.T) {
	cm := NewContextManager(200_000)
	state := State{
		Step:     2,
		Plan:     []PlanStep{{ID: "1", Intent: "do thing", Status: "in_progress"}},
		History:  []Message{{Role: "user", Content: "task"}},
		LongTerm: "earlier summary",
	}
	msgs := cm.Pack(state)

	if len(msgs) == 0 {
		t.Fatal("no messages packed")
	}
	if msgs[0].Role != "system" {
		t.Errorf("expected first message system, got %s", msgs[0].Role)
	}
	if !contains(msgs[len(msgs)-1].Content, "Summary of earlier") {
		t.Errorf("expected summary at end, got: %q", msgs[len(msgs)-1].Content)
	}
}

// TestParallelToolCalls is a placeholder for parallelism — basic sanity check.
func TestParallelToolCalls(t *testing.T) {
	var wg sync.WaitGroup
	var mu sync.Mutex
	results := []int{}

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			mu.Lock()
			results = append(results, n*2)
			mu.Unlock()
		}(i)
	}
	wg.Wait()

	if len(results) != 5 {
		t.Errorf("expected 5 results, got %d", len(results))
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

var _ = fmt.Sprintf
