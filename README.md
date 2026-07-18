# Anvil

```
                  _ _ 
                 (_) |
  __ _ _ ____   ___| |
 / _` | '_ \ \ / / | |
| (_| | | | \ V /| | |
 \__,_|_| |_|\_/ |_|_|
                     
```

**Hit it hard. It remembers.**

Anvil is a Go-based autonomous agent engine that never loses state. Event-sourced, resumable, blazing fast, and designed to be the foundation under whatever agent product you want to build — pentest fleets, smart-money trackers, devin-clones, or your own custom autonomous worker.

## What's new in v0.3

| Feature | What it solves |
|---|---|
| **Async event writer** | Loop never blocks on Postgres writes (buffered + drop counting) |
| **Backpressure-aware fanout** | Slow subscribers counted, never silent |
| **HTTP+SSE server** | `POST /tasks`, `GET /sessions/:id/events?since=X`, real `Last-Event-ID` resume |
| **`FrontendTool` type** | UI tools via the same `Tool` interface, executed over the event channel — no MCP needed for UI |
| **Postgres event store** | Production adapter (in-memory for tests) |
| **Canonical JSON idempotency** | `{a:1,b:2}` and `{b:2,a:1}` produce the same key |
| **Sub-agent coordination** | Dispatch + await with hierarchical event namespace |
| **Structured logging** | Pluggable Logger interface, OTel-ready |
| **10-axis plugin system** | Swap in patterns from any framework (see [docs/best-of-breed.md](docs/best-of-breed.md)) |

## Performance (benchmarks, your machine may vary)

```
BenchmarkEmit_SingleSub-4     474,788 iter    2,741 ns/op    982 B/op    7 allocs/op
BenchmarkEmit_ManySubs-4       54,360 iter   24,042 ns/op  1,043 B/op    8 allocs/op
BenchmarkIdempotencyKey-4   1,220,966 iter     917 ns/op    208 B/op    3 allocs/op
BenchmarkContextPack-4     1,241,205 iter     941 ns/op  2,048 B/op    2 allocs/op
BenchmarkCanonicalJSON-4       55,318 iter   21,623 ns/op  3,136 B/op   87 allocs/op
```

- **2.7 μs per event** with 1 subscriber
- **24 μs per event** with 100 subscribers (linear, no contention)
- **< 1 μs per idempotency key** — safe to call on every tool invocation
- **< 1 μs per context pack** even with 100-message history

## Why Anvil

Most agent frameworks lose progress when:
- The connection drops
- The LLM call times out
- The orchestrator crashes
- The user closes the tab

Anvil doesn't. Every event is persisted before the next step starts. State checkpoints every 5 turns. Tool calls are idempotent (canonical JSON, so `{a:1,b:2}` and `{b:2,a:1}` hash the same). The whole session is a film reel you can pause, rewind, replay — or hand to another orchestrator and pick up where you left off.

## Architecture

```
                    ┌──────────────────────────────┐
                    │      Anvil Engine (Go)        │
                    │                               │
   POST /tasks ───▶  │  ┌──────────┐ ┌──────────┐    │ ───▶ chan Event
                    │  │  Loop    │ │  Tools   │    │       (live stream)
   GET  /stream ──▶  │  └────┬────┘ └─────┬────┘    │
                    │       │            │         │
                    │  ┌────▼────────────▼────┐    │  Postgres
                    │  │  AsyncEventWriter    │    │ ──▶ (source of truth,
                    │  │  + Event log         │    │     append-only)
                    │  │  + InProcessCoord   │    │
                    │  └────┬────────┬────────┘    │
                    │       │        │             │
                    │  ┌────▼───┐ ┌──▼─────┐       │  Frontend tools
                    │  │ Tools  │ │ Sub-   │       │ ──▶ execute over
                    │  │ (calc) │ │ agents │       │     the event
                    │  └────────┘ └────────┘       │     channel
                    │                               │     (no MCP needed)
                    └──────────────────────────────┘
```

### The loop

```go
for s.State.Step < s.cfg.MaxSteps {
    select {
    case <-s.ctx.Done():
        s.checkpoint()  // crash-safe
        return
    default:
    }

    // 1. think — LLM picks the next action
    action, err := s.think()

    // 2. act — if it's a tool call, execute (idempotent)
    if action.IsTool {
        result := s.executeTool(action)  // canonical JSON key
    }

    // 3. update state
    s.State.Step++
    s.State.History = append(s.State.History, action.Message)

    // 4. checkpoint on cadence (non-blocking)
    if s.State.Step % s.cfg.CheckpointEvery == 0 {
        s.checkpoint()
    }

    // 5. check for done
    if action.IsFinal { return nil }
}
```

## Resumability: How it actually works

Three layers, each solving a different failure mode:

| Failure | Recovery |
|---|---|
| Network drop on SSE stream | Frontend reconnects with `Last-Event-ID`, calls `GET /events?since=X` to catch up |
| Agent crash mid-task | Caller invokes `POST /sessions/:id/resume` → loads last checkpoint → continues |
| Tool re-execution on resume | Idempotency key (canonical JSON) = hash(session + tool + args). Cached result replayed without re-run |

The event log is **always** authoritative. Checkpoints are just optimizations — if they fail, the engine rebuilds state from the event log.

## Frontend tools (the no-MCP story)

```go
// Create a tool whose execution lives in the browser
sub := sess.Stream("frontend")
renderChart := core.NewFrontendTool("render_chart", "Render a chart in the UI", sub)
renderChart.SetSchema(map[string]interface{}{...})

// Add to the agent
agent := core.New(core.WithTools(renderChart, ...))

// The agent calls render_chart like any other tool.
// FrontendTool.Execute sends a tool.call event over the stream,
// waits for the matching tool.result, returns it.
```

The frontend listens on the same stream. When it sees a `tool.call` with `is_frontend: true`, it renders, then calls `POST /sessions/:id/tool` with the result. The waiting `Execute` unblocks and returns the result to the agent. **No MCP, no second protocol, no extra round trip.**

## HTTP API (the minimal server)

```bash
# Start a new session
curl -X POST http://localhost:8080/tasks \
  -H "Content-Type: application/json" \
  -d '{"task":"what is 2+2?"}'

# Response: { "session_id": "...", "stream_url": "/sessions/.../events" }

# Stream events (Server-Sent Events)
curl -N http://localhost:8080/sessions/<id>/events
# OR resume from a checkpoint
curl -N "http://localhost:8080/sessions/<id>/events?since=42"

# Frontend returns a tool result
curl -X POST http://localhost:8080/sessions/<id>/tool \
  -H "Content-Type: application/json" \
  -d '{"call_id":"abc","result":{"x":1}}'

# Resume a paused session
curl -X POST http://localhost:8080/sessions/<id>/resume

# Check status
curl http://localhost:8080/sessions/<id>/status
```

## Plugin architecture (the meta-framework position)

Anvil exposes 10 pluggable axes. Pick the patterns you want from each existing framework. See [docs/best-of-breed.md](docs/best-of-breed.md) and [docs/framework-analysis.md](docs/framework-analysis.md) for the full story.

| Axis | Default | Plugin options |
|---|---|---|
| LLM Router | Stub | Anthropic, OpenAI, Ollama, vLLM |
| Tool Source | Go interface | MCP, OpenAPI, OpenAI function-calling |
| Context Packer | 4-tier | RAG-first, scratchpad, sliding-window |
| Planner | Implicit | ReAct, plan-execute |
| Memory | Scratchpad + recent | Vector store, episodic, summarization |
| SubAgent Coord | None | CrewAI roles, AutoGen group chat |
| Streamer | Raw Event | AG-UI, A2A, OpenAI streaming |
| Checkpoint Policy | Every 5 steps | Event-driven, always, never |
| Speculation | None | Parallel LLM, parallel tools |
| Error Recovery | Fail-stop | Reflective retry, human-in-loop |

## Quick start

```go
package main

import (
    "context"
    "fmt"

    "github.com/hamdisoudani/anvil/internal/core"
    "github.com/hamdisoudani/anvil/internal/server"
)

func main() {
    a := core.New(
        core.WithEventStore(core.NewInMemoryEventStore()),
        core.WithCheckpointStore(core.NewInMemoryCheckpointStore()),
        core.WithCache(core.NewInMemoryCache()),
        core.WithLLM(myLLM),  // or core.NewStubLLMRouter(...) for testing
        core.WithToolMap(core.DefaultTools()),
    )

    s := server.NewServer(a, a.EventStore())
    http.ListenAndServe(":8080", s.Handler())
}
```

## Running tests

```bash
go test ./...           # all packages, in-memory
go test -race ./...     # with race detector (recommended)
go test -bench=. ./...  # performance benchmarks
```

**16 tests passing, race-clean.** 5 benchmark suites for performance regression.

## Roadmap

- [x] Core loop, event sourcing, checkpoints, idempotency
- [x] In-memory + Postgres stores
- [x] Async event writer with backpressure
- [x] HTTP+SSE server with `?since=X` resume
- [x] FrontendTool (no-MCP for UI tools)
- [x] Sub-agent coordination scaffold
- [x] Structured logging
- [x] Plugin system (10 axes)
- [ ] Real Anthropic router with prompt caching
- [ ] OpenAI router
- [ ] MCP tool source
- [ ] CrewAI-style sub-agent pack
- [ ] AutoGen-style group chat pack
- [ ] LlamaIndex-style RAG pack

## License

MIT

## Author

Built by [@hamdisoudani](https://github.com/hamdisoudani)
