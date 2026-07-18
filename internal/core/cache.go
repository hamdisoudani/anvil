package core

import (
	"context"
	"time"
)

// Cache groups the three cache types the engine uses.
//
// All three are backed by Redis in production. They can be in-memory for
// testing, or backed by any KV with TTL.
type Cache interface {
	Prompt() PromptCache
	Semantic() SemanticCache
	Idempotency() IdempotencyStore
}

// PromptCache stores LLM prompt cache markers. Anthropic, OpenAI, and most
// providers offer server-side prompt caching — we just need to send the
// right cache_key and the provider handles the rest. This cache stores
// our bookkeeping (which key is current, version, etc).
type PromptCache interface {
	Get(ctx context.Context, key string) (CacheEntry, bool, error)
	Put(ctx context.Context, key string, entry CacheEntry, ttl time.Duration) error
}

type CacheEntry struct {
	Key       string    `json:"key"`
	Hash      string    `json:"hash"`
	Tokens    int       `json:"tokens"`
	CreatedAt time.Time `json:"created_at"`
}

// SemanticCache stores LLM responses keyed by embedding similarity. If a
// similar request comes in (above threshold), we replay the cached response
// without calling the LLM. Hit rates of 20-40% are typical.
//
// Real implementation uses a vector store (Qdrant, pgvector, or Redis with
// vector search). Stub here — the engine doesn't care about the backend.
type SemanticCache interface {
	Lookup(ctx context.Context, embedding []float32, threshold float64) (CachedResponse, bool, error)
	Store(ctx context.Context, embedding []float32, resp CachedResponse) error
}

type CachedResponse struct {
	Text     string    `json:"text"`
	Tokens   int       `json:"tokens"`
	StoredAt time.Time `json:"stored_at"`
}
