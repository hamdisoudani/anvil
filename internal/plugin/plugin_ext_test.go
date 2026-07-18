package plugin

import (
	"context"
	"testing"
)

// TestInMemoryVectorStore_Query verifies cosine similarity ordering.
func TestInMemoryVectorStore_Query(t *testing.T) {
	store := NewInMemoryVectorStore()
	ctx := context.Background()

	// Two vectors
	v1 := make([]float32, 4)
	v1[0], v1[1], v1[2], v1[3] = 1, 0, 0, 0
	v2 := make([]float32, 4)
	v2[0], v2[1], v2[2], v2[3] = 0, 1, 0, 0

	store.Upsert(ctx, "a", v1, nil)
	store.Upsert(ctx, "b", v2, nil)

	// Query with v1 — should return a first
	hits, _ := store.Query(ctx, v1, 2)
	if len(hits) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(hits))
	}
	if hits[0].ID != "a" {
		t.Errorf("expected 'a' first, got %s", hits[0].ID)
	}
	if hits[1].ID != "b" {
		t.Errorf("expected 'b' second, got %s", hits[1].ID)
	}
}

// TestStubAnthropicRouter_Stream verifies the stub emits the right shape.
func TestStubAnthropicRouter_Stream(t *testing.T) {
	r := NewStubAnthropicRouter("hello world")
	ch, err := r.Stream(context.Background(), LLMRequest{})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	var got string
	for chunk := range ch {
		if chunk.Delta != "" {
			got += chunk.Delta
		}
		if chunk.Done && chunk.Usage != nil {
			if !chunk.Usage.Cached {
				t.Error("expected usage.Cached to be true")
			}
			if chunk.Usage.CacheRead == 0 {
				t.Error("expected non-zero CacheRead")
			}
		}
	}
	if got != "hello world" {
		t.Errorf("expected 'hello world', got %q", got)
	}
}
