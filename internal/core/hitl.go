// Human-in-the-Loop as a first-class primitive.
//
// The agent's plan is a list of steps. Any step can be flagged as
// "requires_approval" — the loop pauses, emits an event, and waits
// for the human to approve, edit, or reject.
//
// This isn't a "recovery strategy" — it's how the agent works in
// production. You wouldn't let an agent run a `rm -rf` without
// approval. You wouldn't let it spend $200 without a sanity check.
// HITL is the difference between "demo agent" and "production agent".
//
// The flow:
//   1. Agent's LLM returns a plan with one step marked `requires_approval: true`
//   2. Engine emits `human.approval_required` event with the step
//   3. Engine pauses (returns from the loop)
//   4. Frontend renders the step, user clicks Approve / Edit / Reject
//   5. Frontend sends a state patch back over the stream
//   6. Server applies the patch to the thread
//   7. Frontend calls POST /threads/:id/run to resume with the new state
//   8. Loop continues with the approved/edited plan

package core

import (
	"context"
	"fmt"
	"time"
)

// ApprovalRequired is the event the engine emits when it needs
// human input. Subscribers should display the step and offer
// approve / edit / reject.
type ApprovalRequired struct {
	StepID    string      `json:"step_id"`
	Step      PlanStep    `json:"step"`
	Reason    string      `json:"reason,omitempty"`
	Deadline  time.Time   `json:"deadline,omitempty"`
	Context   interface{} `json:"context,omitempty"`
}

// ApprovalStatus is the response.
type ApprovalStatus string

const (
	ApprovalApproved ApprovalStatus = "approved"
	ApprovalEdited   ApprovalStatus = "edited"
	ApprovalRejected  ApprovalStatus = "rejected"
)

// ApprovalResponse is what the human sends back.
type ApprovalResponse struct {
	StepID string         `json:"step_id"`
	Status ApprovalStatus `json:"status"`
	// For "edited": the new step (with edited fields).
	Edited *PlanStep `json:"edited,omitempty"`
	// For "rejected": why.
	Reason string `json:"reason,omitempty"`
}

// ApprovalGate is the in-memory gate that pauses a run until the
// human responds. One per (thread, step_id).
type ApprovalGate struct {
	Request  ApprovalRequired
	Response chan ApprovalResponse
}

// NewApprovalGate creates a gate.
func NewApprovalGate(req ApprovalRequired) *ApprovalGate {
	return &ApprovalGate{
		Request:  req,
		Response: make(chan ApprovalResponse, 1),
	}
}

// Approve sends an "approved" response.
func (g *ApprovalGate) Approve() {
	g.Response <- ApprovalResponse{StepID: g.Request.StepID, Status: ApprovalApproved}
}

// Edit sends an "edited" response with the new step.
func (g *ApprovalGate) Edit(step PlanStep) {
	g.Response <- ApprovalResponse{StepID: g.Request.StepID, Status: ApprovalEdited, Edited: &step}
}

// Reject sends a "rejected" response.
func (g *ApprovalGate) Reject(reason string) {
	g.Response <- ApprovalResponse{StepID: g.Request.StepID, Status: ApprovalRejected, Reason: reason}
}

// ApprovalRegistry tracks pending gates by thread. The HTTP handler
// looks up a gate by thread+step_id and sends the response.
type ApprovalRegistry struct {
	gates map[string]*ApprovalGate // key: threadID/stepID
}

func NewApprovalRegistry() *ApprovalRegistry {
	return &ApprovalRegistry{gates: make(map[string]*ApprovalGate)}
}

func (r *ApprovalRegistry) key(threadID, stepID string) string {
	return threadID + "/" + stepID
}

func (r *ApprovalRegistry) Register(threadID string, gate *ApprovalGate) {
	r.gates[r.key(threadID, gate.Request.StepID)] = gate
}

func (r *ApprovalRegistry) Get(threadID, stepID string) *ApprovalGate {
	return r.gates[r.key(threadID, stepID)]
}

func (r *ApprovalRegistry) Respond(threadID, stepID string, resp ApprovalResponse) error {
	gate := r.Get(threadID, stepID)
	if gate == nil {
		return fmt.Errorf("no pending approval for %s/%s", threadID, stepID)
	}
	select {
	case gate.Response <- resp:
		delete(r.gates, r.key(threadID, stepID))
		return nil
	default:
		return fmt.Errorf("approval already responded")
	}
}

// waitForHuman blocks until a response arrives or the context is
// cancelled. Returns the response or an error.
func WaitForHuman(ctx context.Context, gate *ApprovalGate) (ApprovalResponse, error) {
	select {
	case resp := <-gate.Response:
		return resp, nil
	case <-ctx.Done():
		return ApprovalResponse{}, ctx.Err()
	}
}
