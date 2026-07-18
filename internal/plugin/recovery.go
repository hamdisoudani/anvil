package plugin

import "context"

// ReflectiveRecovery retries failed tool calls with the error in the prompt.
// This is the "let the LLM think about what went wrong" pattern.
type ReflectiveRecovery struct {
	MaxRetries int
}

// NewReflectiveRecovery returns a recovery that retries with reflection.
func NewReflectiveRecovery(maxRetries int) ErrorRecovery {
	if maxRetries <= 0 {
		maxRetries = 3
	}
	return &ReflectiveRecovery{MaxRetries: maxRetries}
}

// OnError implements the reflect-and-retry loop.
func (r *ReflectiveRecovery) OnError(ctx context.Context, err error, s StateView) (RecoveryAction, error) {
	// If we've already retried too many times, stop
	if s.Step > r.MaxRetries*5 {
		return RecoveryStop, nil
	}
	// Otherwise, retry with the error in the next prompt (handled by engine)
	return RecoveryReflect, nil
}

// HumanInTheLoop pauses for human approval on tool calls.
type HumanInTheLoop struct {
	Threshold string // "any" | "destructive" | "external"
}

// NewHumanInTheLoop returns a recovery that pauses for human input.
func NewHumanInTheLoop() ErrorRecovery {
	return &HumanInTheLoop{Threshold: "destructive"}
}

// OnError returns the action (the engine emits a "human.approval_required"
// event and waits for input).
func (h *HumanInTheLoop) OnError(ctx context.Context, err error, s StateView) (RecoveryAction, error) {
	// Stub: real impl would emit a human.approval_required event
	// and block until the user approves/denies.
	return RecoveryHumanLoop, nil
}

// FailFast stops on any error. Useful in dev/test.
type FailFast struct{}

// NewFailFast returns a recovery that always stops on error.
func NewFailFast() ErrorRecovery { return &FailFast{} }

// OnError always returns Stop.
func (f *FailFast) OnError(ctx context.Context, err error, s StateView) (RecoveryAction, error) {
	return RecoveryStop, nil
}

// Compile-time checks
var (
	_ ErrorRecovery = (*ReflectiveRecovery)(nil)
	_ ErrorRecovery = (*HumanInTheLoop)(nil)
	_ ErrorRecovery = (*FailFast)(nil)
)
