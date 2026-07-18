package plugin

import (
	"context"
	"time"

	"github.com/hamdisoudani/anvil/internal/core"
)

// RunRecord is the canonical run record every plugin writes to.
// It's the cross-plugin audit log. Anvil's "anvil replay" and "anvil
// inspect" tools work on this.
//
// Why a unified record: every framework has its own state shape
// (LangGraph's thread state, AutoGen's transcript, Crew's memory).
// Anvil picks one canonical shape so tools, profilers, and replays
// work across patterns.
//
// The actual struct is in core (not plugin) to avoid import cycles.
// This is a type alias so plugin users can still refer to core.RunRecord
// as plugin.RunRecord.
type RunRecord = core.RunRecord

// ── Action Codec (A4 in the framework analysis) ────────────────────────

// ActionCodec encodes/decodes agent actions in a chosen representation.
// JSON (default), code-as-action (Smolagents), or grammar-constrained
// (Guidance). Different tools can use different codecs — pick per tool.
type ActionCodec interface {
	Name() string
	// Encode takes a logical action and produces a wire-format call
	// the underlying LLM/provider can return.
	Encode(tool string, args map[string]interface{}) (Action, error)
	// Decode takes a wire-format response and produces a logical call.
	Decode(raw []byte) (*ToolCallRequest, error)
	// Sandbox is non-nil for code-as-action codecs (runs the agent's
	// code in an isolated environment before returning observation).
	Sandbox() Sandbox
}

// Sandbox is where code-as-action codecs execute agent-written code.
type Sandbox interface {
	Run(ctx context.Context, code string) (stdout string, err error)
	// Language reports what language the sandbox accepts ("python", "go", etc.)
	Language() string
}

// ── Handoff Policy (A7) ───────────────────────────────────────────────

// HandoffPolicy decides who runs next in a multi-agent conversation.
// - Swarm style: return-an-agent-as-tool-value
// - Crew style: role+goal+backstory with allow_delegation
// - AutoGen style: GroupChatManager picks the speaker
type HandoffPolicy interface {
	Name() string
	// Decide is called after every agent turn. Returns the next agent
	// to run, or nil if the run is done.
	Decide(ctx context.Context, current AgentRef, message Message, peers []AgentRef) (*AgentRef, error)
}

// AgentRef identifies a sub-agent within a session.
type AgentRef struct {
	ID    string
	Role  string
	Model string
}

// ── Contract (A5) ──────────────────────────────────────────────────────

// Contract validates inputs/outputs against a schema. Pydantic-style.
// Every tool can declare a Contract; Anvil enforces it before
// passing args to Execute and after receiving the result.
type Contract interface {
	Name() string
	Validate(value interface{}, schemaID string) error
	GenerateSchema(typ interface{}) (schemaID string, err error)
}

// ── Prompt Compiler (A6) ──────────────────────────────────────────────

// PromptCompiler optimizes prompts against a labeled training set
// and a metric. DSPy-style (MIPROv2 / GEPA) implementations live here.
type PromptCompiler interface {
	Name() string
	// Compile produces an optimized system prompt from examples.
	Compile(ctx context.Context, task Task, metric Metric, trainset []Example) (CompiledPrompt, error)
}

type Task struct {
	Name        string
	Description string
	Examples    []Example
}

type Metric interface {
	Name() string
	Score(predicted, expected string) float64
}

type CompiledPrompt struct {
	System    string
	Tools     []ToolSchema
	Generated time.Time
	Optimizer string
}

// ── Plugin metadata ──────────────────────────────────────────────────

// PluginMeta identifies a plugin. Every plugin should expose this.
type PluginMeta struct {
	Name        string
	Version     string
	Description string
	Author      string
}

// ── Concrete plugin packs (from the framework analysis) ─────────────

// Packs we should ship as separate Go modules:
//
//   anvil-langgraph-compat  - LangGraph patterns
//   anvil-swarm-handoffs    - OpenAI Swarm patterns
//   anvil-creator           - CrewAI patterns
//   anvil-conversation      - AutoGen patterns
//   anvil-typed             - Pydantic AI patterns
//   anvil-atomic            - Atomic Agents patterns
//   anvil-rag               - LlamaIndex / Haystack patterns
//   anvil-workflow          - Mastra patterns
//   anvil-code-agent        - Smolagents patterns (code-as-action)
//   anvil-grammar           - Guidance patterns (token-level CFG)
//   anvil-teleprompter      - DSPy patterns (MIPRO/GEPA optimizers)
//   anvil-visual            - Rivet-style companion UI
//
// Each pack is a separate Go module that the user imports ONLY if
// they want that pattern. Core Anvil stays small.

// ── Anti-recommendations baked into the API ──────────────────────────

// Per the analysis: don't pick defaults for the user. The constructor
// of every plugin slot takes the user's choice. The engine does NOT
// have a default HandoffPolicy, default ActionCodec (well, JSON is
// sensible as a default), default PromptCompiler (none by default),
// or default Contract (none by default).

// JSONActionCodec is the only "default-ish" — JSON tool calls work
// with every modern LLM. It's not really a default, it's just the
// most portable choice.
type JSONActionCodec struct{}

// NewJSONActionCodec returns the JSON tool-call codec.
func NewJSONActionCodec() ActionCodec { return &JSONActionCodec{} }

// Name returns "json".
func (j *JSONActionCodec) Name() string { return "json" }

// Encode wraps the args in a JSON action.
func (j *JSONActionCodec) Encode(tool string, args map[string]interface{}) (Action, error) {
	return Action{
		ToolCall: &ToolCallRequest{
			Name:  tool,
			Input: args,
		},
	}, nil
}

// Decode parses a JSON tool call.
func (j *JSONActionCodec) Decode(raw []byte) (*ToolCallRequest, error) {
	// Real impl: parse OpenAI / Anthropic function-call JSON
	// Stub returns the request as-is
	return &ToolCallRequest{Input: map[string]interface{}{"raw": string(raw)}}, nil
}

// Sandbox is nil — JSON actions don't need execution isolation.
func (j *JSONActionCodec) Sandbox() Sandbox { return nil }

// Compile-time check
var _ ActionCodec = (*JSONActionCodec)(nil)
