package core

import (
	"context"
	"sync"
	"time"
)

// InMemoryCache for tests. Real one wraps Redis.
type InMemoryCache struct {
	mu       sync.RWMutex
	prompts  map[string]CacheEntry
	semantic map[string]CachedResponse
	idem     map[string]ToolResultRecord
}

func NewInMemoryCache() *InMemoryCache {
	return &InMemoryCache{
		prompts:  make(map[string]CacheEntry),
		semantic: make(map[string]CachedResponse),
		idem:     make(map[string]ToolResultRecord),
	}
}

func (c *InMemoryCache) Prompt() PromptCache             { return c }
func (c *InMemoryCache) Semantic() SemanticCache         { return c }
func (c *InMemoryCache) Idempotency() IdempotencyStore { return &IdempotencyAdapter{InMemoryCache: c} }

func (c *InMemoryCache) Get(ctx context.Context, key string) (CacheEntry, bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.prompts[key]
	return e, ok, nil
}

func (c *InMemoryCache) Put(ctx context.Context, key string, entry CacheEntry, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.prompts[key] = entry
	return nil
}

func (c *InMemoryCache) Lookup(ctx context.Context, embedding []float32, threshold float64) (CachedResponse, bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return CachedResponse{}, false, nil
}

func (c *InMemoryCache) Store(ctx context.Context, embedding []float32, resp CachedResponse) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.semantic["stub"] = resp
	return nil
}

// Implements IdempotencyStore
func (c *InMemoryCache) GetIdem(ctx context.Context, key string) (ToolResultRecord, bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	r, ok := c.idem[key]
	return r, ok, nil
}

func (c *InMemoryCache) PutIdem(ctx context.Context, key string, rec ToolResultRecord, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.idem[key] = rec
	return nil
}

// Separate type that explicitly implements IdempotencyStore so the
// InMemoryCache can be returned as both Cache and IdempotencyStore.
type IdempotencyAdapter struct {
	*InMemoryCache
}

func (a *IdempotencyAdapter) Get(ctx context.Context, key string) (ToolResultRecord, bool, error) {
	return a.InMemoryCache.GetIdem(ctx, key)
}

func (a *IdempotencyAdapter) Put(ctx context.Context, key string, rec ToolResultRecord, ttl time.Duration) error {
	return a.InMemoryCache.PutIdem(ctx, key, rec, ttl)
}
