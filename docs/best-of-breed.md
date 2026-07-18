# Anvil: The Best-of-Breed Engine

> Anvil is positioned as a **meta-framework** — instead of being yet another
> opinionated framework, it lets you pick the patterns you want from each
> existing framework and compose them.

## The thesis

> **The engine is fixed. The patterns are configurable.**

Every other framework picks a philosophy and forces you into it. Anvil says:
**pick the pieces that work for your use case, and Anvil glues them together
with event sourcing and resumability as the foundation.**

## The 10 orthogonal axes of agent design

After studying 14 major frameworks (LangGraph, CrewAI, AutoGen, Pydantic AI,
LlamaIndex, Mastra, Smolagents, OpenAI Swarm, Atomic Agents, DSPy, Guidance,
Semantic Kernel, Haystack, Rivet), we identified 10 orthogonal design axes.
Each is a plugin slot. Each framework's distinctive pattern becomes a
concrete plugin.

| # | Axis | What it controls |
|---|---|---|
| **A1** | **State model** | How state is persisted, checkpointed, replayed |
| **A2** | **Control-flow shape** | Linear / DAG / cyclic graph / conversation |
| **A3** | **Agent granularity** | Monolith / role-based team / atomic units |
| **A4** | **Tool-call style** | JSON / code-as-action / grammar-constrained |
| **A5** | **I/O contract** | String / Pydantic-typed / schema-chainable |
| **A6** | **Prompt lifecycle** | Hand-written / templated / compiled by optimizer |
| **A7** | **Handoff model** | None / return-an-agent / graph edge / group-chat |
| **A8** | **Memory model** | Stateless / chat history / thread / vector store |
| **A9** | **Determinism vs emergence** | Scripted / hybrid / emergent |
| **A10** | **Distribution target** | Python-only / TS-only / language-portable |

See [framework-analysis.md](framework-analysis.md) for the deep dive.

## What we steal from each framework

| From | Pattern | How Anvil exposes it |
|---|---|---|
| **LangGraph** | Stateful graph + checkpointer + time-travel | `CheckpointPolicy` + `Engine` plugin |
| **LangGraph** | Human-in-the-loop interrupts | `Recovery` = `RecoveryHumanLoop` |
| **CrewAI** | Role+goal+backstory agents | `AgentFactory` plugin |
| **CrewAI** | `allow_delegation` handoffs | `HandoffPolicy` plugin |
| **AutoGen** | Group chat speaker selection | `HandoffPolicy` = AutoGen-style |
| **Pydantic AI** | Type-safe tool args | `Contract` plugin |
| **LlamaIndex** | RAG as a first-class tool | `Memory` plugin + `ToolSource` |
| **Smolagents** | Code-as-action (agent writes code) | `ActionCodec` = CodeAgent + `Sandbox` |
| **OpenAI Swarm** | Lightweight handoffs | `HandoffPolicy` = Swarm-style |
| **Atomic Agents** | Atomic units with chained I/O | `Contract` plugin |
| **DSPy** | Teleprompter-optimized prompts | `PromptCompiler` plugin |
| **Guidance** | Token-level CFG/regex constraints | `ActionCodec` = grammar |
| **Semantic Kernel** | Enterprise plugin pipeline + filters | `Filter` plugin |
| **Haystack** | Typed-slot pipeline composition | `Engine` plugin |
| **Rivet** | Visual graph editor + remote runtime | Companion app (not core) |
| **Mastra** | Workflow + rewind (LangGraph for TS) | `Engine` plugin |

## What Anvil does better than all of them

1. **Resumable on the protocol level** — none of them treat resume as first-class
2. **Event sourcing as the source of truth** — most use checkpoint-or-nothing
3. **Pluggable at every axis** — frameworks pick one philosophy and lock you in
4. **Production-grade observability** — every event is replayable, queryable
5. **Engine, not framework** — Anvil is the engine, the patterns are config
6. **Canonical Run Record** — single audit log that works across all patterns
7. **Language-portable** — plugins can be Go, Python, anything via RPC/WASM
8. **Long-lived process model** — backpressure, signal handling, graceful shutdown

## The plugin pack roadmap

Each pack is a separate Go module. Users import ONLY what they need:

| Pack | Source | Implements |
|---|---|---|
| `anvil-langgraph-compat` | LangGraph | Checkpointer, cyclic-graph Engine |
| `anvil-swarm-handoffs` | OpenAI Swarm | HandoffPolicy (return-an-agent) |
| `anvil-creator` | CrewAI | AgentFactory, HandoffPolicy (delegation) |
| `anvil-conversation` | AutoGen | Engine (group-chat), HandoffPolicy (manager) |
| `anvil-typed` | Pydantic AI | Contract (Pydantic validation) |
| `anvil-atomic` | Atomic Agents | AgentFactory (atomic I/O schemas) |
| `anvil-rag` | LlamaIndex / Haystack | Memory (vector), Engine (typed multigraph) |
| `anvil-workflow` | Mastra | Engine (suspend/resume/rewind) |
| `anvil-code-agent` | Smolagents | ActionCodec (Python code + sandbox) |
| `anvil-grammar` | Guidance | ActionCodec (regex/CFG/JSON-schema) |
| `anvil-teleprompter` | DSPy | PromptCompiler (MIPRO/GEPA-style) |
| `anvil-visual` | Rivet | Companion GUI that reads Anvil graph specs |

## What the core must provide (the irreducible meta-framework)

1. **Canonical Run Record** — every plugin writes `Run{ThreadID, Step, StateRef, Action, Observation, Cost, Tokens, Latency}`. Tools like `anvil replay` and `anvil inspect` work across patterns.
2. **Event-sourced core loop** — every state change is an append-only event. Postgres is source of truth.
3. **Checkpoint + resume** — load any checkpoint, continue. Idempotent tool calls.
4. **Streaming channel** — raw events out. Plugins format (AG-UI, A2A, OpenAI).
5. **gRPC/WASM plugin contract** — core stays small, plugins can be any language.
6. **Backpressure + signal handling** — long-lived process model. Go's strength.

## Anti-recommendations — what NOT to bake in

- **Don't pick a control-flow default.** Ships the *empty* engine; user picks LangGraph / Haystack / Mastra style.
- **Don't pick a state schema.** The contract is just `[]byte` plus a typed adapter per checkpointer.
- **Don't pick an action representation as a default.** JSON works but it's a *choice*, not a mandate.
- **Don't ship a teleprompter in core.** Cross-cutting; it's a `PromptCompiler` like any other.
- **Don't try to be a UI.** Leave visualization to Rivet-style companion tools.

## Reference architecture (a "best-of-breed" user story)

A research assistant that combines patterns from 5 frameworks:

```go
import (
    "github.com/hamdisoudani/anvil"
    anvil_creator "github.com/hamdisoudani/anvil-creator"      // CrewAI patterns
    anvil_typed "github.com/hamdisoudani/anvil-typed"           // Pydantic patterns
    anvil_code "github.com/hamdisoudani/anvil-code-agent"        // Smolagents patterns
    anvil_workflow "github.com/hamdisoudani/anvil-workflow"    // Mastra patterns
    anvil_rag "github.com/hamdisoudani/anvil-rag"               // LlamaIndex patterns
    anvil_teleprompter "github.com/hamdisoudani/anvil-teleprompter" // DSPy patterns
)

a := anvil.New(
    // CrewAI-style: role+goal+backstory sub-agents
    anvil_creator.WithRole("researcher", "Conduct thorough research", "PhD in CS"),
    anvil_creator.WithRole("writer", "Write engaging content", "NYT bestseller"),
    anvil_creator.WithRole("critic", "Tear arguments apart", "Stanford philosophy"),
    
    // Pydantic-style: type-safe tool args
    anvil_typed.WithContract("SearchInput", SearchInputSchema{}),
    anvil_typed.WithContract("BlogPost", BlogPostSchema{}),
    
    // Smolagents-style: data analyst writes code
    anvil_code.WithCodeExecution(myPythonSandbox),
    
    // Mastra-style: outer workflow with suspend/resume
    anvil_workflow.WithSuspend("human_approval"),
    anvil_workflow.WithRewind("retry_from_step"),
    
    // LlamaIndex-style: RAG memory
    anvil_rag.WithVectorStore(myQdrant),
    
    // DSPy-style: optimize the critic's prompt after 100 eval runs
    anvil_teleprompter.WithOptimizer("GEPA", semanticF1),
)
```

Every one of these is a plugin. None of them is a framework lock-in.

**That's the meta-framework promise.**

---

See [framework-analysis.md](framework-analysis.md) for the full 14-framework breakdown.
See [plugin-architecture.md](plugin-architecture.md) for the axis-by-axis interface design.
