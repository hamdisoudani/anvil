package core

import (
	"context"
	"testing"
	"time"
)

// TestAsyncEventWriter_BufferFull verifies the writer drops events
// (and counts them) when the buffer is full.
func TestAsyncEventWriter_BufferFull(t *testing.T) {
	store := NewInMemoryEventStore()
	w := NewAsyncEventWriter(store, 2)
	defer w.Close()

	// First two should succeed
	for i := 0; i < 2; i++ {
		_, err := w.Append(context.Background(), Event{Type: "test", ID: int64(i)})
		if err != nil {
			t.Errorf("append %d: %v", i, err)
		}
	}

	// Third should fail (buffer full)
	_, err := w.Append(context.Background(), Event{Type: "test", ID: 3})
	if err == nil {
		t.Error("expected error when buffer full")
	}
	if w.Dropped() == 0 {
		t.Error("expected drop counter to increment")
	}
}

// TestAsyncEventWriter_GracefulShutdown verifies Close drains the buffer.
func TestAsyncEventWriter_GracefulShutdown(t *testing.T) {
	store := NewInMemoryEventStore()
	w := NewAsyncEventWriter(store, 10)

	for i := 0; i < 5; i++ {
		w.Append(context.Background(), Event{Type: "test", ID: int64(i)})
	}

	// Close should drain
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Give the goroutine a moment
	time.Sleep(50 * time.Millisecond)

	// Verify the events landed
	events, _ := store.Since(context.Background(), uuidZero, 0, 100)
	if len(events) < 5 {
		t.Errorf("expected at least 5 events after close, got %d", len(events))
	}
}

var uuidZero = mustParseUUID("00000000-0000-0000-0000-000000000000")

func mustParseUUID(s string) (out [16]byte) {
	// Just a stub; we don't actually parse — store.Since on this
	// sentinel returns all events for any sessionID.
	_ = s
	return
}

// TestCanonicalJSON_SortedKeys verifies that key order doesn't affect the hash.
func TestCanonicalJSON_SortedKeys(t *testing.T) {
	a := map[string]interface{}{"a": 1, "b": 2}
	b := map[string]interface{}{"b": 2, "a": 1}

	ca, err := canonicalJSON(a)
	if err != nil {
		t.Fatalf("canonicalize a: %v", err)
	}
	cb, err := canonicalJSON(b)
	if err != nil {
		t.Fatalf("canonicalize b: %v", err)
	}

	if ca != cb {
		t.Errorf("expected canonical forms to match:\n  a=%s\n  b=%s", ca, cb)
	}
}

// TestCanonicalJSON_Nested verifies nested objects also have sorted keys.
func TestCanonicalJSON_Nested(t *testing.T) {
	a := map[string]interface{}{
		"outer": map[string]interface{}{"z": 1, "a": 2},
		"first": "value",
	}
	b := map[string]interface{}{
		"first": "value",
		"outer": map[string]interface{}{"a": 2, "z": 1},
	}

	ca, _ := canonicalJSON(a)
	cb, _ := canonicalJSON(b)

	if ca != cb {
		t.Errorf("expected nested canonical forms to match:\n  a=%s\n  b=%s", ca, cb)
	}
}

// TestIdempotencyKey_OrderInsensitive verifies that the same logical call
// with different key ordering produces the same key.
func TestIdempotencyKey_OrderInsensitive(t *testing.T) {
	a := ToolCallRequest{ID: "1", Name: "calculator", Input: map[string]interface{}{"x": 1, "y": 2}}
	b := ToolCallRequest{ID: "1", Name: "calculator", Input: map[string]interface{}{"y": 2, "x": 1}}

	ca, _ := canonicalJSON(a)
	cb, _ := canonicalJSON(b)

	keyA := idempotencyKey("sess-1", ca)
	keyB := idempotencyKey("sess-1", cb)

	if keyA != keyB {
		t.Errorf("expected idempotency keys to match: a=%s b=%s", keyA, keyB)
	}
}

// TestSub_NoSilentDrop verifies that a slow subscriber's drops are counted.
func TestSub_NoSilentDrop(t *testing.T) {
	sess := &Session{
		State:  State{SessionID: mustParseUUID("11111111-1111-1111-1111-111111111111")},
		subs:   make(map[*Sub]struct{}),
		ctx:    context.Background(),
		writer: NewAsyncEventWriter(NewInMemoryEventStore(), 100),
	}
	defer sess.writer.Close()

	// Slow subscriber with tiny buffer
	sub := &Sub{
		id: "slow",
		Ch: make(chan Event, 1),
	}
	sess.subs[sub] = struct{}{}

	// Emit 5 events without draining
	for i := 0; i < 5; i++ {
		sess.emit(Event{Type: "test", ID: int64(i)})
	}

	// The slow sub should have dropped 4 events (only 1 fit in buffer)
	if sub.Dropped() < 4 {
		t.Errorf("expected at least 4 drops, got %d", sub.Dropped())
	}
}

// TestStderrLogger_BasicOutput verifies the logger doesn't crash.
func TestStderrLogger_BasicOutput(t *testing.T) {
	l := NewStderrLogger()
	l.EnableDebug()
	l.Debug("test debug", map[string]interface{}{"key": "value"})
	l.Info("test info", map[string]interface{}{"key": "value"})
	l.Warn("test warn", map[string]interface{}{"key": "value"})
	l.Error("test error", map[string]interface{}{"key": "value"})
}

// TestNoopLogger verifies it accepts everything silently.
func TestNoopLogger(t *testing.T) {
	var l Logger = NoopLogger{}
	l.Debug("d", nil)
	l.Info("i", nil)
	l.Warn("w", nil)
	l.Error("e", nil)
}

// TestRunRecordStore verifies records are written and listed.
func TestRunRecordStore(t *testing.T) {
	store := NewInMemoryRunRecordStore()

	rec1 := RunRecord{ThreadID: "t1", Step: 1, Action: Action{}}
	rec2 := RunRecord{ThreadID: "t1", Step: 2, Action: Action{}}
	rec3 := RunRecord{ThreadID: "t2", Step: 1, Action: Action{}}

	store.Append(rec1)
	store.Append(rec2)
	store.Append(rec3)

	list := mustList(t, store, "t1", 0)
	if len(list) != 2 {
		t.Errorf("expected 2 records for t1, got %d", len(list))
	}

	list2 := mustList(t, store, "t1", 2)
	if len(list2) != 1 {
		t.Errorf("expected 1 record with since=2, got %d", len(list2))
	}

	list3 := mustList(t, store, "t2", 0)
	if len(list3) != 1 {
		t.Errorf("expected 1 record for t2, got %d", len(list3))
	}
}

func mustList(t *testing.T, s RunRecordStore, thread string, since int) []RunRecord {
	t.Helper()
	out, err := s.List(thread, since)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return out
}

// TestSubAgentCoord_DispatchAndEmit verifies sub-agent events are emitted.
func TestSubAgentCoord_DispatchAndEmit(t *testing.T) {
	a := New(
		WithEventStore(NewInMemoryEventStore()),
		WithCheckpointStore(NewInMemoryCheckpointStore()),
		WithCache(NewInMemoryCache()),
		WithLLM(NewStubLLMRouter("sub-agent done")),
		WithToolMap(DefaultTools()),
	)
	coord := NewInProcessSubAgentCoord(a)

	sess, err := a.newSession(context.Background(), "test sub-agent")
	if err != nil {
		t.Fatalf("newSession: %v", err)
	}
	sub := sess.Stream("test")

	handle, err := coord.Dispatch(context.Background(), sess, "researcher", "find bugs")
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if handle.ID() == "" {
		t.Error("expected non-empty handle ID")
	}

	// Wait for completion
	result, err := coord.Await(context.Background(), handle)
	if err != nil {
		t.Fatalf("await: %v", err)
	}
	if result.Err != nil {
		t.Errorf("sub-agent error: %v", result.Err)
	}

	// Drain events — should include EventSubagent with action=start and action=done
	got := map[string]bool{}
	timeout := time.After(2 * time.Second)
loop:
	for {
		select {
		case e, ok := <-sub.Channel():
			if !ok {
				break loop
			}
			if e.Type == EventSubagent {
				if action, _ := e.Payload["action"].(string); action != "" {
					got[action] = true
				}
			}
		case <-timeout:
			break loop
		}
	}

	if !got["start"] {
		t.Error("expected sub-agent 'start' event")
	}
	if !got["done"] {
		t.Error("expected sub-agent 'done' event")
	}
}
