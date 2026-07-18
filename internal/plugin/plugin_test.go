package plugin

import (
	"testing"

	"github.com/google/uuid"
)

// TestAGUIStreamer_FormatAllEventTypes verifies every event type maps to
// a valid AG-UI event.
func TestAGUIStreamer_FormatAllEventTypes(t *testing.T) {
	s := NewAGUIStreamer()
	if s.ContentType() != "text/event-stream" {
		t.Errorf("wrong content type: %s", s.ContentType())
	}

	sessionID := uuid.New()
	cases := []string{
		"session.start",
		"think.start",
		"think.chunk",
		"think.end",
		"tool.call",
		"tool.result",
		"checkpoint",
		"error",
		"done",
		"paused",
		"unknown.event",
	}
	for _, et := range cases {
		out, err := s.Format(Event{
			Type:      EventType(et),
			SessionID: sessionID,
			Payload:   map[string]interface{}{"test": "data"},
		})
		if err != nil {
			t.Errorf("Format(%s) error: %v", et, err)
		}
		ag, ok := out.(AGUIEvent)
		if !ok {
			t.Errorf("Format(%s) wrong type: %T", et, out)
			continue
		}
		if ag.RunID != sessionID.String() {
			t.Errorf("Format(%s) wrong run_id: %s", et, ag.RunID)
		}
		if ag.Type == "" {
			t.Errorf("Format(%s) empty type", et)
		}
	}
}

// TestStepCheckpoint verifies the cadence policy.
func TestStepCheckpoint(t *testing.T) {
	p := NewStepCheckpoint(5)
	ev := Event{Type: "test"}

	// 5 steps since last checkpoint (0) — should trigger
	if !p.ShouldCheckpoint(5, 0, ev) {
		t.Error("expected checkpoint at step 5 (gap of 5)")
	}
	// 6 steps since last checkpoint — also triggers
	if !p.ShouldCheckpoint(6, 0, ev) {
		t.Error("expected checkpoint at step 6 (gap of 6)")
	}
	// 2 steps since last checkpoint at 5 — should NOT trigger
	if p.ShouldCheckpoint(7, 5, ev) {
		t.Error("expected no checkpoint at step 7 with last=5 (gap of 2)")
	}
	// 5 steps since last at 5 — should trigger
	if !p.ShouldCheckpoint(10, 5, ev) {
		t.Error("expected checkpoint at step 10 with last=5 (gap of 5)")
	}
}

// TestEventDrivenCheckpoint verifies it triggers on the right events.
func TestEventDrivenCheckpoint(t *testing.T) {
	p := NewEventDrivenCheckpoint("tool.result", "done")
	if !p.ShouldCheckpoint(0, 0, Event{Type: "tool.result"}) {
		t.Error("expected checkpoint on tool.result")
	}
	if p.ShouldCheckpoint(0, 0, Event{Type: "think.chunk"}) {
		t.Error("expected no checkpoint on think.chunk")
	}
}

// TestRecoveries returns the right action for each strategy.
func TestRecoveries(t *testing.T) {
	s := StateView{Step: 10}
	cases := []struct {
		name   string
		r      ErrorRecovery
		expect RecoveryAction
	}{
		{"FailFast", NewFailFast(), RecoveryStop},
		{"HumanInTheLoop", NewHumanInTheLoop(), RecoveryHumanLoop},
	}
	for _, c := range cases {
		got, err := c.r.OnError(nil, errStub, s)
		if err != nil {
			t.Errorf("%s: unexpected error: %v", c.name, err)
		}
		if got != c.expect {
			t.Errorf("%s: got %v, want %v", c.name, got, c.expect)
		}
	}
}

var errStub = errorString("stub error")

type errorString string

func (e errorString) Error() string { return string(e) }
