package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// executeTool runs a tool call with idempotency. If the same call was made
// before (same key), the cached result is returned without re-execution.
//
// Idempotency is what makes resume safe. The agent may re-decide to call
// the same tool on resume — we don't want it to fire twice.
func (s *Session) executeTool(action Action) ToolResult {
	var payload string
	if action.ToolCall != nil {
		b, _ := json.Marshal(action.ToolCall)
		payload = string(b)
	}
	key := idempotencyKey(s.State.SessionID.String(), payload)

	// Check cache first
	if rec, ok, _ := s.cache.Idempotency().Get(s.ctx, key); ok {
		var result interface{}
		json.Unmarshal(rec.Result, &result)
		return ToolResult{Key: key, Result: result, Cached: true}
	}

	// Look up tool
	tool, exists := s.tools[action.ToolCall.Name]
	if !exists {
		return ToolResult{Key: key, Err: fmt.Errorf("unknown tool: %s", action.ToolCall.Name)}
	}

	// Execute (with timeout per tool)
	tctx, cancel := context.WithTimeout(s.ctx, 60*time.Second)
	defer cancel()

	result, err := tool.Execute(tctx, action.ToolCall.Input)
	if err != nil {
		// Even errors are cached — same arg + same broken state = same error
		rec := ToolResultRecord{Key: key, Err: err.Error(), StoredAt: time.Now()}
		s.cache.Idempotency().Put(s.ctx, key, rec, s.cfg.IdempotencyTTL)
		return ToolResult{Key: key, Err: err}
	}

	// Cache and return
	b, _ := json.Marshal(result)
	rec := ToolResultRecord{Key: key, Result: b, StoredAt: time.Now()}
	s.cache.Idempotency().Put(s.ctx, key, rec, s.cfg.IdempotencyTTL)

	return ToolResult{Key: key, Result: result, Cached: false}
}

type ToolResult struct {
	Key    string
	Result interface{}
	Err    error
	Cached bool
}

func (r ToolResult) Event() map[string]interface{} {
	m := map[string]interface{}{"key": r.Key, "cached": r.Cached}
	if r.Err != nil {
		m["err"] = r.Err.Error()
	} else {
		m["result"] = r.Result
	}
	return m
}

func idempotencyKey(sessionID, payload string) string {
	// Canonical args would be sorted, but we trust the model to send stable JSON.
	h := sha256.Sum256([]byte(sessionID + "|" + payload))
	return hex.EncodeToString(h[:])
}
