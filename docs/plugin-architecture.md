# Anvil Plugin Architecture — Brainstorm

## The goal
Make Anvil a meta-framework where users pick the patterns they want
from each existing framework, not a re-implementation of one philosophy.

## What we already have (Anvil v0.1)
- Think-act-observe loop
- Event-sourced (Postgres)
- Checkpoint-based resume
- Idempotent tool calls
- 4-tier context packing

## The axes — what can be swapped without rewriting

### 1. LLM Router
Default: stub. Plugins: Anthropic / OpenAI / Ollama / vLLM.
**What it decides:** which model, prompt caching, streaming, tool-call format.

### 2. Tool format
Default: Go interface. Plugins: MCP server / OpenAPI / OpenAI function-calling schema.
**What it decides:** how tools are defined, discovered, executed.

### 3. Context packing
Default: 4-tier. Plugins: RAG-first, scratchpad-only, sliding-window.
**What it decides:** what the LLM sees at each step.

### 4. Planning style
Default: implicit (LLM decides each step). Plugins: explicit plan/track, ToT, ReAct, plan-and-execute.
**What it decides:** how the agent sequences actions.

### 5. Memory model
Default: scratchpad + recent. Plugins: long-term vector store, episodic, summarization-on-write.
**What it decides:** what gets remembered between sessions.

### 6. Sub-agent coordination
Default: none. Plugins: CrewAI-style roles, AutoGen-style group chat, hierarchical.
**What it decides:** how multiple agents collaborate.

### 7. Streaming format
Default: raw Event. Plugins: AG-UI, A2A task updates, OpenAI streaming.
**What it decides:** how the outside world consumes the engine.

### 8. Checkpoint cadence
Default: every 5 steps. Plugins: on-tool-call, time-based, on-pause.
**What it decides:** resume granularity.

### 9. Speculation
Default: none. Plugins: speculative LLM calls, parallel tool dispatch.
**What it decides:** latency vs cost.

### 10. Error recovery
Default: fail-stop. Plugins: retry-with-reflection, fall-through, human-in-the-loop.
**What it decides:** how the engine handles bad LLM calls / tool errors.

## What's missing in every other framework (Anvil's opportunity)

1. **Resumable on the protocol level** — none of them treat resume as first-class
2. **Event sourcing as the source of truth** — most use checkpoint-or-nothing
3. **Pluggable at every axis** — frameworks pick one philosophy
4. **Production-grade observability** — every event is replayable, queryable
5. **Engine, not framework** — Anvil is the engine, the patterns are config

## Code sketch — what the plugin interface should look like

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
}

func New(opts ...Option) *Agent {
    cfg := AgentConfig{
        LLM:      defaultLLM,
        Tools:    defaultTools,
        Context:  defaultContext,
        // ... sensible defaults
    }
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
func WithAGUI() Option
```

## What we build next

Pick 2-3 axes that make Anvil immediately more flexible than v0.1:
- **LLM router** (Anthropic) — non-negotiable
- **Tool source (MCP)** — for tool ecosystem
- **Streamer (AG-UI)** — for the frontend
- **Memory (RAG)** — for long-running agents

Everything else stays in core. The plugin system is the gate.
