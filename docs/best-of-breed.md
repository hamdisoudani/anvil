# Anvil: The Best-of-Breed Engine

> Anvil is positioned as a **meta-framework** — instead of being yet another
> opinionated framework, it lets you pick the patterns you want from each
> existing framework and compose them.

## What we steal from each framework

| From | What we steal | How Anvil exposes it |
|---|---|---|
| **LangGraph** | Stateful graph execution with explicit checkpoints | `CheckpointPolicy` plugin |
| **LangGraph** | Human-in-the-loop interrupts (`interrupt_before`, `interrupt_after`) | `Recovery` plugin: `WaitForHuman` |
| **CrewAI** | Role-based agents (researcher, writer, reviewer) | `WithRoles(...)` config |
| **CrewAI** | Task delegation with explicit `context` passing | `SubAgent.Task.Context` |
| **AutoGen** | Conversational group chat between agents | `GroupChat` plugin |
| **AutoGen** | Speaker selection (round-robin, manual, auto) | `WithSpeakerSelection(...)` |
| **Pydantic AI** | Type-safe tool args with Pydantic-style validation | `Tool.Schema()` with validators |
| **Pydantic AI** | Dependency injection (typed context into tools) | `Tool.Deps` field |
| **LlamaIndex** | RAG as a first-class tool | `WithRAG(vectorStore)` |
| **LlamaIndex** | Query engines with structured outputs | `Tool.Query` interface |
| **Smolagents** | Code-as-action (agent writes Python, runs it) | `WithCodeExecution(sandbox)` |
| **OpenAI Swarm** | Lightweight handoffs (one-shot function calls that pass control) | `Handoff` event type |
| **Atomic Agents** | System prompt as code (template-able, composable) | `SystemPrompt.Template` |
| **DSPy** | Compiled prompts (optimize over examples) | `WithDSPyOptimizer(optimizer)` |
| **Guidance** | Token-level generation control (regex, JSON schema enforced) | `WithGuidedDecoding(schema)` |
| **Semantic Kernel** | Enterprise plugin system (kernel, filters, planners) | `Filter` plugin pipeline |
| **Haystack** | Pipeline composition (component graphs) | `Pipeline` builder |

## What Anvil does better than all of them

1. **Resumable on the protocol level** — none of them treat resume as first-class
2. **Event sourcing as the source of truth** — most use checkpoint-or-nothing
3. **Pluggable at every axis** — frameworks pick one philosophy and lock you in
4. **Production-grade observability** — every event is replayable, queryable
5. **Engine, not framework** — Anvil is the engine, the patterns are config

## The 10 pluggable axes

### 1. LLM Router
Default: stub. Plugins: Anthropic / OpenAI / Ollama / vLLM.
**Decides:** model, prompt caching, streaming, tool-call format.

### 2. Tool Source
Default: Go interface. Plugins: MCP server, OpenAPI, OpenAI function-calling.
**Decides:** how tools are defined, discovered, executed.

### 3. Context Packer
Default: 4-tier. Plugins: RAG-first, scratchpad-only, sliding-window.
**Decides:** what the LLM sees at each step.

### 4. Planner
Default: implicit (LLM decides each step). Plugins: explicit plan/track, ToT, ReAct, plan-and-execute.
**Decides:** how the agent sequences actions.

### 5. Memory
Default: scratchpad + recent. Plugins: long-term vector store, episodic, summarization-on-write.
**Decides:** what gets remembered between sessions.

### 6. Sub-agent Coordination
Default: none. Plugins: CrewAI roles, AutoGen group chat, hierarchical.
**Decides:** how multiple agents collaborate.

### 7. Streamer
Default: raw Event. Plugins: AG-UI, A2A, OpenAI streaming, custom JSON.
**Decides:** how the outside world consumes the engine.

### 8. Checkpoint Policy
Default: every 5 steps. Plugins: on-tool-call, time-based, on-pause, never.
**Decides:** resume granularity.

### 9. Speculation
Default: none. Plugins: speculative LLM, parallel tool dispatch.
**Decides:** latency vs cost.

### 10. Error Recovery
Default: fail-stop. Plugins: retry-with-reflection, fall-through, human-in-loop.
**Decides:** how the engine handles bad LLM calls / tool errors.

## Code shape

```go
type AgentConfig struct {
    LLM       LLMRouter
    Tools     ToolSource
    Context   ContextPacker
    Planner   Planner
    Memory    Memory
    Streamer  StreamFormatter
    CP        CheckpointPolicy
    Recovery  ErrorRecovery
    Speakers  SpeakerSelection
    Filters   []Filter
}

func New(opts ...Option) *Agent {
    cfg := defaultConfig()  // sensible defaults for every axis
    for _, opt := range opts {
        opt(&cfg)
    }
    return &Agent{cfg: cfg}
}

// Functional options
func WithLLM(r LLMRouter) Option
func WithMCP(endpoint string) Option
func WithRAGMemory(store VectorStore) Option
func WithCrewStyle() Option
func WithGroupChat() Option
func WithAGUI() Option
func WithHumanInTheLoop() Option
func WithCodeExecution(sandbox Executor) Option
func WithDSPyOptimizer(opt Optimizer) Option
func WithSpeculation() Option
```

## What gets built in v0.2 (the plugin MVP)

Pick the 3 that prove the pattern works:
- **LLM router** (Anthropic) — proves we can swap LLMs
- **MCP tool source** — proves we can use any tool ecosystem
- **AG-UI streamer** — proves we can be the engine under any client

Then v0.3 adds:
- CrewAI-style roles
- AutoGen-style group chat
- LlamaIndex-style RAG memory

Then v0.4 adds:
- DSPy optimizer
- Human-in-the-loop
- Code-as-action (sandboxed)

## Why this matters

The agent space is fragmented. Every framework picks one philosophy and
forces you into it. Anvil says: **the engine is fixed, the patterns are
configurable**. You pick the pieces that work for your use case, and
Anvil glues them together with event sourcing and resumability as the
foundation.

That's the bet: every team will eventually need resume + observability.
The framework they picked will resist. Anvil won't.
