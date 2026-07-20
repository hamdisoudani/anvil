package core

import (
	"errors"
	"fmt"
)

// ── Interrupt Types ──────────────────────────────────────────────

// InterruptReason describes why the agent paused.
type InterruptReason string

const (
	// InterruptApproval: agent needs a yes/no before continuing.
	// Example: "Can I deploy to production?"
	InterruptApproval InterruptReason = "approval"

	// InterruptInput: agent needs arbitrary user input.
	// Example: "What URL should I crawl?"
	InterruptInput InterruptReason = "input"

	// InterruptToolConfirm: agent wants the user to confirm a tool call.
	// Example: "Do you authorize deleting 500 records?"
	InterruptToolConfirm InterruptReason = "tool_confirm"

	// InterruptChoice: agent needs the user to pick from options.
	// Example: "Which database should I query: production or staging?"
	InterruptChoice InterruptReason = "choice"

	// InterruptUI: agent wants to render something in the UI and wait.
	// Example: render a chart, show a diff, display a form
	InterruptUI InterruptReason = "ui"
)

// InterruptPayload is what the agent sends to the frontend when it needs input.
// The frontend renders this and sends a response via DeliverResult.
type InterruptPayload struct {
	// Reason tells the frontend what kind of UI to show.
	Reason InterruptReason `json:"reason"`

	// Title is a short human-readable prompt (e.g. "Approve deployment").
	Title string `json:"title"`

	// Message is a longer description.
	Message string `json:"message,omitempty"`

	// Options for InterruptChoice — the list of valid picks.
	Options []string `json:"options,omitempty"`

	// Schema for the expected response shape (JSON Schema).
	// For InterruptInput, this defines the expected fields.
	Schema map[string]interface{} `json:"schema,omitempty"`

	// RenderHint for InterruptUI — tells the frontend what to render.
	// e.g. "diff", "chart", "form", "markdown", "custom"
	RenderHint string `json:"render_hint,omitempty"`

	// Data is opaque data for the frontend to render.
	Data interface{} `json:"data,omitempty"`
}

// ── Convenience constructors ─────────────────────────────────────

// AskApproval emits an InterruptApproval and waits for a bool.
// Use as a FrontendTool's Execute handler.
func AskApproval(question string) InterruptPayload {
	return InterruptPayload{
		Reason:  InterruptApproval,
		Title:   "Approval required",
		Message: question,
	}
}

// AskQuestion emits an InterruptInput and waits for structured data.
// schema describes the expected fields in JSON Schema format.
func AskQuestion(prompt string, schema map[string]interface{}) InterruptPayload {
	return InterruptPayload{
		Reason: InterruptInput,
		Title:  prompt,
		Schema: schema,
	}
}

// ShowOptions emits an InterruptChoice and waits for the index of the chosen option.
func ShowOptions(question string, options []string) InterruptPayload {
	return InterruptPayload{
		Reason:  InterruptChoice,
		Title:   question,
		Options: options,
	}
}

// InterruptError is returned when the user rejects or the interrupt times out.
type InterruptError struct {
	Reason  InterruptReason
	Message string
}

func (e *InterruptError) Error() string {
	return fmt.Sprintf("interrupt [%s]: %s", e.Reason, e.Message)
}

// ErrInterruptRejected is returned when the user explicitly rejects.
var ErrInterruptRejected = errors.New("interrupt rejected by user")
