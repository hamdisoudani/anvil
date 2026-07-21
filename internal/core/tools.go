package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// executeTool runs a tool call with idempotency. If the same call was made
// before (same key), the cached result is returned without re-execution.
//
// Idempotency is what makes resume safe. The agent may re-decide to call
// the same tool on resume — we don't want it to fire twice.
// Middleware is applied around the actual tool.Execute call.
func (s *Session) executeTool(action Action) ToolResult {
	var payload string
	if action.ToolCall != nil {
		canonical, err := canonicalJSON(action.ToolCall)
		if err == nil {
			payload = canonical
		} else {
			// Fall back to raw JSON if canonicalization fails
			b, _ := json.Marshal(action.ToolCall)
			payload = string(b)
		}
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

	// Execute (with timeout per tool), wrapped in middleware chain
	tctx, cancel := context.WithTimeout(s.ctx, 60*time.Second)
	defer cancel()

	step := s.applyMiddleware(func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error) {
		out, err := tool.Execute(ctx, action.ToolCall.Input)
		if err != nil {
			return MiddlewareResponse{}, err
		}
		return MiddlewareResponse{Output: out}, nil
	})

	resp, err := step(tctx, MiddlewareRequest{
		Type:      MiddlewareTool,
		Payload:   action.ToolCall.Name,
		SessionID: s.State.SessionID.String(),
	})
	if err != nil {
		// Even errors are cached — same arg + same broken state = same error
		rec := ToolResultRecord{Key: key, Err: err.Error(), StoredAt: time.Now()}
		s.cache.Idempotency().Put(s.ctx, key, rec, s.cfg.IdempotencyTTL)
		return ToolResult{Key: key, Err: err}
	}

	// Cache and return
	b, _ := json.Marshal(resp.Output)
	rec := ToolResultRecord{Key: key, Result: b, StoredAt: time.Now()}
	s.cache.Idempotency().Put(s.ctx, key, rec, s.cfg.IdempotencyTTL)

	return ToolResult{Key: key, Result: resp.Output, Cached: false}
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
	h := sha256.Sum256([]byte(sessionID + "|" + payload))
	return hex.EncodeToString(h[:])
}

// canonicalJSON serializes a value with sorted keys, so semantically
// equal objects always produce the same bytes. This is what makes
// idempotency actually idempotent — {a:1, b:2} and {b:2, a:1} hash
// the same.
func canonicalJSON(v interface{}) (string, error) {
	// Marshal normally, then re-parse to a generic map and re-marshal
	// with sorted keys.
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	var generic interface{}
	if err := json.Unmarshal(b, &generic); err != nil {
		return "", err
	}
	return marshalSorted(generic)
}

func marshalSorted(v interface{}) (string, error) {
	switch t := v.(type) {
	case map[string]interface{}:
		// Collect keys and sort them
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		// Build JSON manually with sorted keys
		var b []byte
		b = append(b, '{')
		for i, k := range keys {
			if i > 0 {
				b = append(b, ',')
			}
			kb, _ := json.Marshal(k)
			b = append(b, kb...)
			b = append(b, ':')
			vb, err := marshalSorted(t[k])
			if err != nil {
				return "", err
			}
			b = append(b, vb...)
		}
		b = append(b, '}')
		return string(b), nil
	case []interface{}:
		var b []byte
		b = append(b, '[')
		for i, item := range t {
			if i > 0 {
				b = append(b, ',')
			}
			vb, err := marshalSorted(item)
			if err != nil {
				return "", err
			}
			b = append(b, vb...)
		}
		b = append(b, ']')
		return string(b), nil
	default:
		b, err := json.Marshal(t)
		return string(b), err
	}
}
