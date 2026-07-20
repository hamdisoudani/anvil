package core

import (
	"context"
	"fmt"
)

// ── Agent Middleware ──────────────────────────────────────────────
//
// Middleware lets you wrap any part of the agent execution with
// custom logic — before/after LLM calls, tool execution, node
// transitions, and event emission.
//
// Usage:
//
//	agent := core.New(
//	  core.WithMiddleware(core.RateLimiter(10)),
//	  core.WithMiddleware(core.Logger),
//	)
//
// Middlewares are composed left-to-right (first applied = outermost).

// Middleware is a decorator for agent execution steps.
// Each Middleware receives the next step in the chain and returns
// a wrapper that may intercept or modify the execution.
//
// Return the passed `next` unchanged to pass through.
type Middleware func(next MiddlewareStep) MiddlewareStep

// MiddlewareStep is a single point in the agent loop that can be wrapped.
type MiddlewareStep func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error)

// MiddlewareRequest carries context about what the agent is about to do.
type MiddlewareRequest struct {
	// Type tells the middleware what kind of step this is.
	Type MiddlewareType `json:"type"`

	// LLMRound: the prompt being sent to the LLM
	// ToolCall: the tool name and args
	// NodeExecute: the node name and state
	// Interrupt: the interrupt payload
	Payload interface{} `json:"payload,omitempty"`

	// SessionID the agent is running in
	SessionID string `json:"session_id,omitempty"`
}

// MiddlewareType discriminates what the middleware is wrapping.
type MiddlewareType string

const (
	// MiddlewareLLM wraps every LLM call.
	MiddlewareLLM MiddlewareType = "llm"

	// MiddlewareTool wraps every tool execution (server + frontend).
	MiddlewareTool MiddlewareType = "tool"

	// MiddlewareNode wraps every graph node execution.
	MiddlewareNode MiddlewareType = "node"

	// MiddlewareStream wraps every event emitted (intercept/filter/modify).
	MiddlewareStream MiddlewareType = "stream"

	// MiddlewareInterrupt wraps interrupt/wait-for-user blocks.
	MiddlewareInterrupt MiddlewareType = "interrupt"
)

// MiddlewareResponse is what the step returns.
type MiddlewareResponse struct {
	// Output is the result of the step (LLM response, tool result, etc.)
	Output interface{} `json:"output,omitempty"`

	// InterruptRequest is set when the step needs user input.
	// The framework will pause and wait for the frontend to respond.
	InterruptRequest *InterruptPayload `json:"interrupt_request,omitempty"`
}

// ── Built-in middleware factories ────────────────────────────────

// StepLogger is a middleware that logs every step (use the existing core.Logger).
func StepLogger(next MiddlewareStep) MiddlewareStep {
	return func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error) {
		// TODO: structured log
		// log.Printf("[%s] %s: %+v", req.SessionID, req.Type, req.Payload)
		return next(ctx, req)
	}
}

// RateLimiter limits tool calls per second.
func RateLimiter(maxPerSecond int) Middleware {
	var tokens chan struct{}
	return func(next MiddlewareStep) MiddlewareStep {
		return func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error) {
			if req.Type == MiddlewareTool {
				// Limiting only tool calls
				if tokens == nil {
					tokens = make(chan struct{}, maxPerSecond)
					for i := 0; i < maxPerSecond; i++ {
						tokens <- struct{}{}
					}
				}
				select {
				case <-tokens:
					defer func() { go func() { tokens <- struct{}{} }() }()
				case <-ctx.Done():
					return MiddlewareResponse{}, ctx.Err()
				}
			}
			return next(ctx, req)
		}
	}
}

// WithAuth adds authentication checks before tool execution.
func WithAuth(validator func(ctx context.Context, toolName string) error) Middleware {
	return func(next MiddlewareStep) MiddlewareStep {
		return func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error) {
			if req.Type == MiddlewareTool {
				toolName, ok := req.Payload.(string)
				if !ok {
					return MiddlewareResponse{}, fmt.Errorf("auth: expected string payload for tool, got %T", req.Payload)
				}
				if err := validator(ctx, toolName); err != nil {
					return MiddlewareResponse{}, err
				}
			}
			return next(ctx, req)
		}
	}
}

// WithRetry retries failed steps up to `maxAttempts` times.
func WithRetry(maxAttempts int) Middleware {
	return func(next MiddlewareStep) MiddlewareStep {
		return func(ctx context.Context, req MiddlewareRequest) (MiddlewareResponse, error) {
			var lastErr error
			for i := 0; i < maxAttempts; i++ {
				resp, err := next(ctx, req)
				if err == nil {
					return resp, nil
				}
				lastErr = err
			}
			return MiddlewareResponse{}, lastErr
		}
	}
}
