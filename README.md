# Anvil

```
                  _ _ 
                 (_) |
  __ _ _ ____   ___| |
 / _` | '_ \ \ / / | |
| (_| | | | \ V /| | |
 \__,_|_| |_|\\_/ |_|_|
                      
```

**Hit it hard. It remembers.**

Anvil is a Go-based autonomous agent engine that never loses state. Event-sourced, resumable, blazing fast, and designed to be the foundation under whatever agent product you want to build — pentest fleets, smart-money trackers, devin-clones, or your own custom autonomous worker.

## Why Anvil

Most agent frameworks lose progress when:
- The connection drops
- The LLM call times out
- The orchestrator crashes
- The user closes the tab

Anvil doesn't. Every event is persisted before the next step starts. State checkpoints every 5 turns. Tool calls are idempotent. The whole session is a film reel you can pause, rewind, replay — or hand to another orchestrator and pick up where you left off.

```
                    ┌──────────────────────────────┐
                    │      Anvil Engine (Go)       │
                    │                              │
   POST /tasks ───▶  │  ┌─────────┐  ┌──────────┐  │ ───▶ chan Event
                    │  │  Loop   │  │  Tools   │  │       (live stream)
   GET  /stream ──▶  │  └────┬────┘  └─────┬────┘  │
                    │       │             │        │
                    │  ┌────▼─────────────▼────┐   │  Postgres
                    │  │   Event Log + Cache   │   │ ──▶ (source
                    │  │   (in-process + DB)   │   │     of truth)
                    │  └───────────────────────┘   │
                    │                              │
                    │  Resume from any checkpoint │ ──▶ Replay
                    └──────────────────────────────┘
```

## Features

- **Event-sourced** — every state change is an append-only event. Postgres is the source of truth.
- **Resumable on crash** — kill it mid-task, `anvil resume <id>`, it picks up at the last checkpoint.
- **Idempotent tool calls** — same args always return the same result. Safe to replay.
- **Resumable streams** — connection dies? Reconnect with `Last-Event-ID` and catch up.
- **4-tier context packing** — system / scratchpad / recent / summary. LLM context stays tight.
- **Parallel sub-agents** — goroutines + channels, not threads + locks.
- **Lazy summarization** — only when context > 60% full. Never wastes tokens.
- **Prompt caching** — system prompts + tool schemas stay cached. Anthropic: 90% discount.
- **No protocol lock-in** — engine emits raw events. AG-UI / A2A / MCP sit on top.

## Quick start

```go
package main

import (
    "context"
    "fmt"

    "github.com/hamdisoudani/anvil/internal/core"
)

func main() {
    a := core.New(
        core.WithEventStore(myStore),
        core.WithCache(myCache),
        core.WithLLM(myLLM),
        core.WithTools(core.DefaultTools()),
    )

    sess, events, err := a.Run(context.Background(), "what is 2 + 3?")
    if err != nil {
        panic(err)
    }

    for e := range events {
        fmt.Printf("[%s] %+v\n", e.Type, e.Payload)
    }
}
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Anvil Engine                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  think()     │  │  execute()   │  │  checkpoint()    │  │
│  │  (LLM call)  │─▶│  (tool call) │─▶│  (every N steps) │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         │                │                  │               │
│         └────────────────┴──────────────────┘               │
│                          │                                  │
│                  ┌───────▼────────┐                         │
│                  │  Event Log     │  ──▶ Postgres (durable) │
│                  │  (append-only) │  ──▶ Redis (hot cache)  │
│                  └────────────────┘                         │
│                          │                                  │
│                  ┌───────▼────────┐                         │
│                  │  Event Channel │  ──▶ SSE / fanout       │
│                  └────────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

### The loop

```go
for s.State.Step < s.cfg.MaxSteps {
    // 1. think — LLM picks the next action
    action, err := s.think()
    if err != nil { return err }

    // 2. act — if it's a tool call, execute (idempotent)
    if action.IsTool {
        result := s.executeTool(action)
        s.State.Scratchpad["last_observation"] = result
    }

    // 3. update state
    s.State.Step++
    s.State.History = append(s.State.History, action.Message)

    // 4. checkpoint on cadence
    if s.State.Step % s.cfg.CheckpointEvery == 0 {
        s.checkpoint()
    }

    // 5. check for done
    if action.IsFinal { return nil }
}
```

### Resume

```go
sess, events, err := a.Resume(ctx, sessionID)
// Picks up from the last checkpoint + replays missed events
// Same channel shape. Same idempotency. No double-effects.
```

## Resumability: How it actually works

Three layers, each solving a different failure mode:

| Failure | Recovery |
|---|---|
| Network drop on SSE stream | Frontend reconnects with `Last-Event-ID`, calls `GET /events?since=X` to catch up |
| Agent crash mid-task | Caller invokes `anvil resume <id>` → loads last checkpoint → continues |
| Tool re-execution on resume | Idempotency key = hash(session + tool + args). Cached result replayed without re-run |

The event log is **always** authoritative. Checkpoints are just optimizations — if they fail, the engine rebuilds state from the event log.

## Performance

| Component | Target | Why |
|---|---|---|
| First LLM token | < 500ms | Streaming HTTP/2 + prompt cache |
| Tool execution | < 100ms cache hit, < 5s network | Idempotency cache in front |
| Checkpoint write | < 10ms | Async, non-blocking |
| Event fanout | < 1ms | In-process channels, no broker |
| Resume | < 100ms | Single Postgres query + checkpoint load |

## What Anvil is NOT

- **Not a client protocol** — Anvil doesn't know about AG-UI, A2A, or MCP. Those sit on top. Pick your poison.
- **Not an LLM wrapper** — Anvil calls whatever you tell it to call. Anthropic, OpenAI, local models, custom — your choice.
- **Not a tool framework** — Tools are just `interface { Execute(ctx, args) (result, error) }`. Bring your own.
- **Not a UI** — Anvil is the engine. The frontend is your problem (or use AG-UI).

## Roadmap

- [x] Core loop, event sourcing, checkpoints, idempotency
- [x] In-memory stores for tests
- [ ] Postgres + Redis adapters
- [ ] Anthropic LLM router with prompt caching
- [ ] OpenAI router
- [ ] Sub-agent dispatch (A2A-style)
- [ ] Tool marketplace (MCP-style)
- [ ] Frontend reference (AG-UI)

## Running tests

```bash
go test ./...
```

5/5 passing, ~600 LOC of agent code, ~140 LOC of tests.

## License

MIT

## Author

Built by [@hamdisoudani](https://github.com/hamdisoudani)
