// Package plugin: the Anvil plugin system.
//
// Anvil's engine is fixed. The patterns are configurable. Every agent
// design choice lives behind one of 10 pluggable axes:
//
//   1. LLM Router        — which model, how to stream, how to cache
//   2. Tool Source       — how tools are defined and discovered
//   3. Context Packer    — what the LLM sees at each step
//   4. Planner           — how the agent sequences actions
//   5. Memory            — what gets remembered between sessions
//   6. SubAgent Coord    — how multiple agents collaborate
//   7. Streamer          — how the outside world consumes events
//   8. CheckpointPolicy  — when to snapshot state
//   9. Speculation       — parallel work for lower latency
//  10. ErrorRecovery     — how to handle bad LLM calls / tool errors
//
// Each axis is a Go interface. The core engine talks to the interface;
// users plug in the implementation that matches their philosophy.
package plugin

import (
	"context"

	"github.com/google/uuid"

	"github.com/hamdisoudani/anvil/internal/core"
)

// Re-exported types so plugin users don't need to import core.
type (
	Event      = core.Event
	EventType  = core.EventType
	State      = core.State
	PlanStep   = core.PlanStep
	Message    = core.Message
	Tool       = core.Tool
	Action     = core.Action
	ToolResult = core.ToolResult

	LLMRequest      = core.LLMRequest
	LLMChunk        = core.LLMChunk
	TokenUsage      = core.TokenUsage
	ToolCallRequest = core.ToolCallRequest
	ToolSchema      = core.ToolSchema

	EventStore         = core.EventStore
	CheckpointStore    = core.CheckpointStore
	IdempotencyStore   = core.IdempotencyStore
	Cache              = core.Cache
	PromptCache        = core.PromptCache
	SemanticCache      = core.SemanticCache
	LLMRouter          = core.LLMRouter
	SubAgentHandle     = core.SubAgentHandle
	SubAgentResult     = core.SubAgentResult
	SubAgentCoord      = core.SubAgentCoord
	Session            = core.Session
)

// Config is the assembled set of plugin choices.
type Config struct {
	LLM         LLMRouter
	Tools       ToolSource
	Context     ContextPacker
	Planner     Planner
	Memory      Memory
	Streamer    StreamFormatter
	Checkpoint  CheckpointPolicy
	Speculation Speculation
	Recovery    ErrorRecovery
	SubAgents   SubAgentCoord
}

// Option is a functional option for customizing an Agent.
type Option func(*Config)

// WithLLM sets the LLM router (Anthropic, OpenAI, Ollama, custom).
func WithLLM(r LLMRouter) Option { return func(c *Config) { c.LLM = r } }

// WithMCP discovers tools from an MCP server endpoint.
func WithMCP(endpoint string) Option { return func(c *Config) { c.Tools = NewMCPSource(endpoint) } }

// WithRAGMemory plugs in a vector store for long-term memory.
func WithRAGMemory(store VectorStore) Option {
	return func(c *Config) { c.Memory = NewRAGMemory(store) }
}

// WithAGUI emits events in the AG-UI streaming format.
func WithAGUI() Option { return func(c *Config) { c.Streamer = NewAGUIStreamer() } }

// WithCrewStyle activates role-based sub-agent coordination.
func WithCrewStyle() Option { return func(c *Config) { c.SubAgents = NewCrewCoord() } }

// WithGroupChat activates AutoGen-style group chat.
func WithGroupChat() Option { return func(c *Config) { c.SubAgents = NewGroupChat() } }

// WithHumanInTheLoop pauses for approval on tool calls above a threshold.
func WithHumanInTheLoop() Option {
	return func(c *Config) { c.Recovery = NewHumanInTheLoop() }
}

// WithCodeExecution lets the agent write and run code in a sandbox.
func WithCodeExecution(sandbox Executor) Option {
	return func(c *Config) { c.Tools = NewCodeExecTools(sandbox) }
}

// WithSpeculation enables parallel LLM calls and tool execution.
func WithSpeculation() Option {
	return func(c *Config) { c.Speculation = NewSpeculator() }
}

// ── Axis 1: LLM Router ────────────────────────────────────────────────

// LLMRouter streams tokens, handles tool calls, manages prompt caching.
// (Defined as type alias above; the original interface lives in core.)

// ── Axis 2: Tool Source ───────────────────────────────────────────────

// ToolSource provides tools to the agent.
type ToolSource interface {
	Tools() []Tool
	Refresh(ctx context.Context) error
}

// ── Axis 3: Context Packer ─────────────────────────────────────────────

// ContextPacker assembles the messages the LLM sees at each step.
type ContextPacker interface {
	Pack(s StateView) []Message
	MaybeSummarize(s *StateView) bool
	SystemPrompt() string
	CacheKey() string
}

// StateView is a read-only snapshot the packer sees.
type StateView struct {
	Step       int
	Plan       []PlanStep
	Scratchpad map[string]interface{}
	History    []Message
	LongTerm   string
	SessionID  uuid.UUID
}

// ── Axis 4: Planner ────────────────────────────────────────────────────

// Planner decides the agent's next action.
type Planner interface {
	Next(ctx context.Context, s StateView) (Plan, error)
	ShouldReplan(s StateView, lastResult interface{}) bool
}

type Plan struct {
	IsFinal   bool
	Answer    string
	ToolCall  *ToolCallRequest
	Reasoning string
}

// ── Axis 5: Memory ─────────────────────────────────────────────────────

// Memory is what the agent remembers between steps and between sessions.
type Memory interface {
	Recall(ctx context.Context, s StateView) (string, error)
	Remember(ctx context.Context, s StateView, key string, value interface{}) error
	LongTerm(ctx context.Context, s StateView) (string, error)
}

// VectorStore is the RAG backend.
type VectorStore interface {
	Upsert(ctx context.Context, id string, embedding []float32, metadata map[string]interface{}) error
	Query(ctx context.Context, embedding []float32, topK int) ([]VectorHit, error)
}

type VectorHit struct {
	ID       string
	Score    float32
	Metadata map[string]interface{}
}

// ── Axis 6: Sub-agent Coordination ────────────────────────────────────

// SubAgentCoord handles fan-out and message passing between sub-agents.
// (Defined as type alias above; the original interface lives in core.)
type SubAgentCall struct {
	Role string
	Task string
}

// ── Axis 7: Streamer ───────────────────────────────────────────────────

// StreamFormatter converts internal events to the wire format.
type StreamFormatter interface {
	Format(e Event) (any, error)
	ContentType() string
}

// ── Axis 8: Checkpoint Policy ─────────────────────────────────────────

// CheckpointPolicy decides when to snapshot state.
type CheckpointPolicy interface {
	ShouldCheckpoint(step int, lastCheckpoint int, e Event) bool
}

// ── Axis 9: Speculation ───────────────────────────────────────────────

// Speculation enables parallel work for lower latency.
type Speculation interface {
	Plan(ctx context.Context, s StateView) ([]Plan, error)
	Resolve(results []Plan) Plan
}

// ── Axis 10: Error Recovery ───────────────────────────────────────────

// ErrorRecovery handles bad LLM calls, tool errors, and timeouts.
type ErrorRecovery interface {
	OnError(ctx context.Context, err error, s StateView) (RecoveryAction, error)
}

type RecoveryAction int

const (
	RecoveryStop RecoveryAction = iota
	RecoveryRetry
	RecoveryReflect
	RecoveryHumanLoop
	RecoveryFallback
)

// ── Cross-cutting ─────────────────────────────────────────────────────

// Filter runs on every event.
type Filter interface {
	Name() string
	Apply(ctx context.Context, e *Event) (*Event, error)
}

// Optimizer is the DSPy-style prompt compilation hook.
type Optimizer interface {
	Optimize(ctx context.Context, examples []Example) (OptimizedPrompt, error)
}

type Example struct {
	Input  map[string]interface{}
	Output string
	Score  float64
}

type OptimizedPrompt struct {
	System string
	Tools  []ToolSchema
}

// Executor runs arbitrary code in a sandbox.
type Executor interface {
	Run(ctx context.Context, code string) (stdout string, err error)
}

// ── Placeholder constructors (filled in by individual plugin files) ───

var (
	NewMCPSource     func(endpoint string) ToolSource
	NewCrewCoord     func() SubAgentCoord
	NewGroupChat     func() SubAgentCoord
	NewCodeExecTools func(sandbox Executor) ToolSource
	NewSpeculator    func() Speculation
)
