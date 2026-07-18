package core

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// BenchmarkEmit_SingleSub measures the cost of emit with one subscriber.
func BenchmarkEmit_SingleSub(b *testing.B) {
	sess := &Session{
		State:  State{SessionID: parseTestUUID()},
		subs:   make(map[*Sub]struct{}),
		ctx:    context.Background(),
		writer: NewAsyncEventWriter(NewInMemoryEventStore(), 4096),
	}
	defer sess.writer.Close()
	sub := &Sub{id: "bench", Ch: make(chan Event, 1024)}
	sess.subs[sub] = struct{}{}
	go func() { for range sub.Ch {} }() // drain

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sess.emit(Event{Type: "test", ID: int64(i)})
	}
}

// BenchmarkEmit_ManySubs measures fanout to many subscribers.
func BenchmarkEmit_ManySubs(b *testing.B) {
	sess := &Session{
		State:  State{SessionID: parseTestUUID()},
		subs:   make(map[*Sub]struct{}),
		ctx:    context.Background(),
		writer: NewAsyncEventWriter(NewInMemoryEventStore(), 4096),
	}
	defer sess.writer.Close()

	const nSubs = 100
	for i := 0; i < nSubs; i++ {
		sub := &Sub{id: fmt.Sprintf("s%d", i), Ch: make(chan Event, 1024)}
		sess.subs[sub] = struct{}{}
		go func(s *Sub) { for range s.Ch {} }(sub)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sess.emit(Event{Type: "test", ID: int64(i)})
	}
}

// BenchmarkCanonicalJSON measures the cost of canonical JSON.
func BenchmarkCanonicalJSON(b *testing.B) {
	v := map[string]interface{}{
		"name":    "calculator",
		"input":   map[string]interface{}{"x": 1, "y": 2, "z": 3, "w": 4, "v": 5},
		"options": map[string]interface{}{"precision": 2, "rounding": "half-up"},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = canonicalJSON(v)
	}
}

// BenchmarkIdempotencyKey measures the cost of key derivation.
func BenchmarkIdempotencyKey(b *testing.B) {
	payload := `{"name":"calculator","input":{"x":1,"y":2,"z":3,"w":4,"v":5}}`
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = idempotencyKey("sess-1", payload)
	}
}

// BenchmarkContextPack measures context packing with full history.
func BenchmarkContextPack(b *testing.B) {
	cm := NewContextManager(200_000)
	msgContent := "a reasonably long message content here for the benchmark test "
	state := State{
		Step: 50,
		History: func() []Message {
			msgs := make([]Message, 100)
			for i := range msgs {
				msgs[i] = Message{Role: "user", Content: msgContent + msgContent + msgContent + msgContent + msgContent}
			}
			return msgs
		}(),
		LongTerm: strings.Repeat("Earlier summary of the conversation ", 20),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cm.Pack(state)
	}
}

func parseTestUUID() (out [16]byte) {
	// helper that returns a non-zero UUID for benchmarks
	copy(out[:], []byte("00000000-0000-0000-0000-000000000001"))
	return
}
