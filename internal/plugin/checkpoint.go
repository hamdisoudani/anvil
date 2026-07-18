package plugin

import "context"

// StepCheckpoint is the default CheckpointPolicy: snapshot every N steps.
type StepCheckpoint struct {
	Every int
}

// NewStepCheckpoint returns a policy that checkpoints every N steps.
func NewStepCheckpoint(every int) CheckpointPolicy {
	if every <= 0 {
		every = 5
	}
	return &StepCheckpoint{Every: every}
}

// ShouldCheckpoint returns true if the gap from the last checkpoint is
// at least Every. The engine tracks lastCheckpoint and passes it in.
func (s *StepCheckpoint) ShouldCheckpoint(step, lastCheckpoint int, e Event) bool {
	return step-lastCheckpoint >= s.Every
}

// EventDrivenCheckpoint snapshots after specific event types (e.g. tool
// calls). Useful when tool calls are expensive and you want fine-grained
// resume around them.
type EventDrivenCheckpoint struct {
	Events map[string]bool
}

// NewEventDrivenCheckpoint checkpoints after the given event types.
func NewEventDrivenCheckpoint(events ...string) CheckpointPolicy {
	m := make(map[string]bool, len(events))
	for _, e := range events {
		m[e] = true
	}
	return &EventDrivenCheckpoint{Events: m}
}

// ShouldCheckpoint returns true if the event is in the trigger list.
func (e *EventDrivenCheckpoint) ShouldCheckpoint(step, lastCheckpoint int, ev Event) bool {
	return e.Events[string(ev.Type)]
}

// AlwaysCheckpoint is the paranoid option: every step.
type AlwaysCheckpoint struct{}

// NewAlwaysCheckpoint snapshots on every step.
func NewAlwaysCheckpoint() CheckpointPolicy { return &AlwaysCheckpoint{} }

// ShouldCheckpoint always returns true.
func (a *AlwaysCheckpoint) ShouldCheckpoint(step, lastCheckpoint int, e Event) bool {
	return true
}

// Compile-time checks
var (
	_ CheckpointPolicy = (*StepCheckpoint)(nil)
	_ CheckpointPolicy = (*EventDrivenCheckpoint)(nil)
	_ CheckpointPolicy = (*AlwaysCheckpoint)(nil)
)

var _ = context.Background
