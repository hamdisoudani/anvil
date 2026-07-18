# Critique 1 — Architecture & Stream Design

**Reviewer:** Senior distributed systems architect
**Subject:** Anvil — Go-based, event-sourced, resumable agent engine
**Scope:** Streaming model, event ordering, multi-consumer story, sub-agent hierarchy, frontend tool integration
**Tone:** Skeptical, evidence-based, severity-tagged. Nice-to-haves are excluded.

---

## TL;DR — Headline Findings

Anvil has a real architectural thesis (event sourcing + resumability in Go), and the latest iteration (named `*Sub` with per-subscriber drop counters, `AsyncEventWriter` for non-blocking persistence) is more sophisticated than the README implies. But the headline is not the code — the headline is the **gap between the marketing claims and the guarantees the code actually provides**:

1. The system **does not provide** total ordering, causal ordering, at-least-once delivery, or durable streaming. It provides *best-effort in-process fanout + a separate append-only log*, and silently decouples them.
2. The "Postgres is the source of truth" claim is **already compromised by the AsyncEventWriter** in the same file that mentions the claim.
3. The multi-consumer story works for *live* consumers on the same node, **breaks on cross-node fanout**, and has no compaction / catch-up cursor story.
4. Sub-agent hierarchy is **defined in the design doc but not implemented in the engine** — `EventSubagent` exists as a constant, no emission path, no `SubAgentCoord` integration in `loop()`.
5. "Frontend tools are first-class via the same `Tool` interface" is **factually true but operationally wrong** — there is no event channel that lets the frontend drive `Execute`, only the LLM does.
6. The "Go runtime advantage" is real for cold-start and concurrency, but the current code trades it away by holding `s.mu` over LLM calls and using a `chan Event, 64` (now 256) buffer that drops on saturation.

The design is *interesting*; the implementation is *alpha*. Treat the docs as aspirations, not contracts.

---

## Severity legend

- **CRITICAL** — system will lose data, lie about guarantees, or fail under stated workloads
- **HIGH** — claim is misleading, will break in production at small scale, or blocks a core feature
- **MEDIUM** — design smell, will cause operator pain, but a workaround exists
- **LOW** — paper cut, future burden

---

## 1. CRITICAL — AsyncEventWriter decouples durability from the loop, then pretends it didn't

**File:** `internal/core/async_writer.go:1-112`, `internal/core/agent.go:98`, `internal/core/store.go:57, 97`, `internal/core/emit.go:26-35`

The README claims (lines 25, 46):
> "Every event is persisted before the next step starts. … Postgres is the source of truth."

The new `AsyncEventWriter` makes that literally false. `emit()` enqueues the event into a buffered channel (`bufferSize=4096`) and returns immediately. The loop continues to the next step. The actual `store.Append` happens in a background goroutine.

Concretely:

```go
// internal/core/emit.go:20-35
func (s *Session) emit(e Event) {
    ...
    if s.writer != nil {
        s.writer.Append(writeCtx, e)   // enqueue, return 0, nil — does NOT block
    } ...
}
```

```go
// internal/core/async_writer.go:79-93
func (w *AsyncEventWriter) Append(ctx context.Context, e Event) (int64, error) {
    select {
    case w.in <- e:
        return 0, nil
    default:
        atomic.AddUint64(&w.dropped, 1)  // dropped = lost
        return 0, errBufferFull
    }
}
```

**Why it matters.**
- The "durability first" claim is the **single competitive moat** versus LangGraph (Postgres checkpointer), AG-UI (HTTP+SSE), and AutoGen (transcript). Trading it for hot-path latency makes Anvil a strictly-worse copy of AG-UI's "live stream, hope it persists" model — without AG-UI's HTTP semantics that at least let a client know when to retry.
- The `LastEventID` resume story is now racy: a subscriber reconnecting with `?since=42` may find that events 43, 44, 45 are in flight to Postgres but not committed, or are still in the buffer. The engine has no way to tell them "the gap is durable" vs "the gap is in memory."
- The drop counter (`Dropped()`) is process-local. An operator in another node (or in a postmortem) cannot distinguish "I lost N events" from "I never produced N events."

**Fix.** Pick one of three explicit positions and document it in `EventStore`:
- **A. Synchronous by default.** Make `store.Append` blocking inside `emit`. The hot path slows down; you pay the Postgres round-trip per token chunk. Acceptable only if you batch events before flush.
- **B. Outbox / transaction-coherent.** Persist the event row in the **same transaction** as the state change it represents (Postgres `INSERT … RETURNING id`, hold a row-level write lock on the session). "Source of truth" becomes real; the `AsyncEventWriter` deletes itself.
- **C. At-least-once with explicit gap protocol.** Each event carries a sequence number assigned *at enqueue time* (not at commit time). The subscriber consumes `(seq, durableUpTo)`. The SSE handler emits a `gap` marker whenever `durableUpTo < seq-1`. `?since=N` is defined as "give me everything > N that is durable" — a long-polling / Notify pattern on the writer's `LSN`. Document that "durable" and "delivered" are two different guarantees.

The current code is a fourth, undocumented option: "fire and forget, increment a counter nobody reads."

---

## 2. CRITICAL — Event IDs are not assigned atomically with the event; `EventID` is never set; `LastEventID` is dead state

**File:** `internal/core/agent.go:21-28, 56`, `internal/core/emit.go:20-35`, `internal/core/async_writer.go:79-93`

```go
// internal/core/agent.go:21
type Event struct {
    ID         int64  `json:"-"`           // Postgres serial, internal ordering
    EventID    string `json:"event_id"`    // client-visible monotonic, stable across resume
    ...
}
```

Two ID fields, both broken:

- **`ID`** is set by `store.Append(e)` *synchronously* in the old path (`store.go` originally) and *asynchronously* in the new path. `emit()` cannot fill it before fan-out. Every subscriber that receives an event from a live channel sees `ID == 0`, then a different value when read back via `Since()`. There is no way to correlate them.
- **`EventID`** (the *client-visible* ID) is **never written to anywhere**. Grep confirms: zero assignments. It's a doc-only field. Resume-by-`EventID` is impossible.
- **`State.LastEventID`** (`agent.go:56`) is also never read or written by `emit()`, `checkpoint()`, or `loop()`. It exists in the struct purely as furniture.

**Why it matters.** The whole point of an event-sourced system is replay-by-cursor. If cursors don't exist, you don't have event sourcing — you have a journal that you can tail from the beginning. A subscriber reconnecting after a network blip has to either (a) re-read the entire session from the start (impossible past 1k events) or (b) accept silent loss.

**Fix.**
- Assign `(sessionID, seq)` in `emit()` *before* fan-out, from an in-process atomic counter scoped to the session. This is the *delivery* sequence.
- Persist `(session_id, seq, durable_seq)` in Postgres. `durable_seq` is the high-water mark of what's committed.
- Subscribers receive `Event{Seq, DeliveredUpTo, EventID}`. `?since=seq` means "give me events with seq > seq where seq <= durable_seq."
- Replace `ID`/`EventID` with one canonical `Seq int64` and one canonical `EventID uuid.UUID` (server-assigned, unique, survives replay).

---

## 3. CRITICAL — No multi-consumer story in code; the claim is in the doc only

**File:** `internal/core/agent.go:88, 144-156`, `internal/core/emit.go:55-96`, `internal/plugin/agui.go`, `docs/best-of-breed.md:62, 67`

The "multi-consumer" promise (README claim, repeated in `best-of-breed.md`) is that "Multiple consumers can attach to same session read-only." What the code actually does:

- `subs map[*Sub]struct{}` lives *on the Session struct* (`agent.go:88`).
- `*Sub` is created in-process by `sess.Stream(id)` (`emit.go:89`).
- There is **no HTTP/SSE/gRPC adapter in the engine package** that lets a remote process attach.
- `agui.go` is a `StreamFormatter` — it formats events for a *single consumer's* SSE response. It doesn't multiplex, doesn't track per-connection cursors, doesn't handle reconnect.

`EventStore.Stream` (`store.go:20`, `store_memory.go:58`) is the only cross-process fanout surface, and:
- It is implemented only in the in-memory store.
- It returns a channel that closes after replay; there is no live tailing semantics defined.
- `?since=N` works on a serial ID, which (per Finding #2) is not assignable until after persistence.

**Why it matters.** "Multiple consumers" is the stated differentiator vs AG-UI. Without it, Anvil is "AG-UI on the same side of the network boundary as the engine." Multi-consumer across nodes requires:
- An outbox or `LISTEN/NOTIFY` (Postgres) / `XADD` (Redis Streams) / Kafka / NATS JetStream consumer-group semantics
- Per-consumer cursor persistence
- A wire protocol (gRPC stream or WebSocket) with backpressure — not a `chan Event, 256`

**Fix.**
- Pick one of: Postgres `LISTEN/NOTIFY` (good enough until ~10k events/sec), Redis Streams (good to ~100k/sec), or NATS JetStream (good past that). Document the choice.
- Define a `Consumer` interface in the engine: `Consumer{ID, Group, ResumeFromSeq, Channel}`. Persist `consumer_progress` per `(session, group)`.
- Build the SSE adapter *as a real plugin* (`anvil-agui`) that connects to the chosen broker, not as a `StreamFormatter` over a single in-process channel. `agui.go` is the wrong layer.

---

## 4. HIGH — `loop()` holds `s.mu` across `think()`; concurrency advantage is forfeit

**File:** `internal/core/agent.go:180-208`

```go
// internal/core/agent.go:180
s.mu.Lock()
if s.State.Step >= s.cfg.MaxSteps { ... }
s.mu.Unlock()

// 1. Think
action, err := s.think()         // ← no lock; reads s.State
...
// 3. Update state
s.mu.Lock()
s.State.Step++
s.State.History = append(s.State.History, action.Message)
s.mu.Unlock()
```

The good news: `s.mu` is not held during `think()`. The bad news: the entire `loop()` is a single goroutine, so the "Go concurrency advantage" the README claims is **unused in the main path**. `Run()` returns a session with one goroutine, one LLM call at a time, sequential.

Compare to what the docs imply:
- "Parallel sub-agents — goroutines + channels, not threads + locks" (README:51)
- `TestParallelToolCalls` (`agent_test.go:149`) tests `sync.WaitGroup` directly — not the engine. It's a placeholder that proves Go can do concurrency, not that Anvil does.

The `SubAgentCoord` interface exists in `plugin.go:174-194`. It is not called from `loop()`. The `EventSubagent` constant is declared (`agent.go:40`) but never emitted anywhere.

**Why it matters.** Two compounding issues:
- A real sub-agent (Crew-style fan-out) requires `loop()` to *spawn* a sub-loop, share the same `subs` map, and emit hierarchical events. The current code is single-goroutine and `subs` is owned by one session. There is no nesting primitive.
- The "Go concurrency advantage" pitch is a *potential* advantage. The engine, as written, gets the startup-time and memory savings but not the parallel-execution savings. The marketing is 30% ahead of the code.

**Fix.**
- Restructure `loop()` as a step-graph executor: each step is a node, parallel steps are goroutines that share a sync.WaitGroup, all events funnel into a single ordered channel before `emit()`. This is what LangGraph's `Pregel` runtime does, and it's the right shape.
- Add a `Session.ParentID uuid.UUID` field; `emit()` auto-tags child events with `parent_id` and a `(parent_seq, child_seq)` tuple. AG-UI's `STATE_DELTA` already has a parent-event primitive; use it.
- Either implement `SubAgentCoord` or remove the `EventSubagent` constant and the `WithCrewStyle()` / `WithGroupChat()` plugin options that currently can't run.

---

## 5. HIGH — "Frontend tools" claim is true at the type level, false at the protocol level

**File:** `internal/core/agent.go:75-81`, `internal/core/tools.go:17-56`, `internal/plugin/agui.go`, `README.md:54, 173`

The claim: "Frontend tools are first-class via the same `Tool` interface, execute via event channel."

The reality: the only entity that calls `tool.Execute` is `Session.executeTool` (`tools.go:42`), which is called by `loop()` after `think()` returns. The only way a tool is invoked is if the LLM decided to call it. There is no event channel that lets a frontend **push** a tool execution back to the engine. The frontend's only "tool" surface is to wait for `tool.call` to appear in the SSE stream and then *display* something.

This is the protocol-level confusion at the heart of AG-UI's design too — but AG-UI at least has `STATE_DELTA` and `TOOL_CALL_START` events that *imply* the frontend can be in the loop. Anvil's `agui.go` formats the event but doesn't define the reverse channel.

What a real "frontend tool" looks like:
1. The engine exposes a tool whose `Execute` is not a function but a **promise of a value**.
2. The engine emits a `tool.call_pending` event with a `request_id`.
3. The frontend renders the tool (e.g., a form for "what's your shipping address?").
4. The frontend calls `POST /sessions/{id}/tools/{request_id}` with the result.
5. The engine resumes the loop with the supplied value.

None of this exists. The README's "the frontend is your problem (or use AG-UI)" (line 174) is *correct*; the README's "frontend tools are first-class" is *wrong by the engine's own admission three lines later*.

**Fix.** Either:
- **Remove the claim** from the README and design docs. "Anvil is not a UI" plus "frontend tools are first-class" is incoherent.
- **Implement the reverse channel.** Add a `FrontendTool` interface: `type FrontendTool interface { Tool; PendingKey() string }`. Add a `Session.SubmitToolResult(requestID string, value any) error` method that resumes a waiting `executeTool`. Wire it to a gRPC or HTTP endpoint. This is ~150 lines and the only honest way to back the claim.

---

## 6. HIGH — Idempotency key is wrong, masking real correctness bugs

**File:** `internal/core/tools.go:75-79`, `internal/core/agent.go:201`

```go
// internal/core/tools.go:75
func idempotencyKey(sessionID, payload string) string {
    // Canonical args would be sorted, but we trust the model to send stable JSON.
    h := sha256.Sum256([]byte(sessionID + "|" + payload))
    return hex.EncodeToString(h[:])
}
```

Two correctness bugs hiding behind "we trust the model":

1. **Non-canonical JSON.** The same logical call `{"a":1,"b":2}` and `{"b":2,"a":1}` hash to different keys. The model emits these inconsistently across providers. A retry that reorders keys will not hit the cache, so the tool re-runs. "Idempotent" is now load-bearing for the resume story (`README:48`); a miss means double-execution of side-effecting tools.
2. **`s.State.Scratchpad["last_observation"] = result`** (`agent.go:201`) — `result` is the `ToolResult` struct (with `Err`, `Cached`, `Key` fields), not the unwrapped observation. The scratchpad is then JSON-serialized into the LLM context as `"Last observation: {"cached":false,"key":"...","result":5}"`. The LLM will be confused and the context packer (`context.go:62-66`) trusts the 8k byte-size heuristic to hide this. It will not catch semantic garbage.

**Why it matters.** A user who builds "send this email" on Anvil will see double-sent emails after a network blip. The cache is the *only* line of defense and it is unreliable.

**Fix.**
- Canonicalize args before hashing: `json.Marshal(sortJSON(args))` with a stable key-sorter. Or use `reflect.DeepEqual` on a sorted-keys map. ~30 lines.
- Store `result.Result` in the scratchpad, not the wrapper. `s.State.Scratchpad["last_observation"] = result.Result` (with the appropriate nil check).
- Add a `TestIdempotency_KeyOrderIndependent` test that hashes `{"a":1,"b":2}` and `{"b":2,"a":1}` and asserts equal.

---

## 7. HIGH — Sub-agent hierarchy in the stream is declared, not implemented

**File:** `docs/best-of-breed.md:6, 67, 91`, `docs/framework-analysis.md:579, 738`, `internal/core/agent.go:40`, `internal/plugin/plugin.go:174-194`, `internal/core/agent.go:169-220` (the `loop`)

The design docs (and the prompt that commissioned this critique) claim:
> "Sub-agents emit events in same stream with hierarchical namespace."

What the code does:
- `EventSubagent` is one of 11 event type constants (`agent.go:40`). It is **never emitted by any code path.** Grep `s.emit(Event{Type: EventSubagent` returns 0 hits.
- `SubAgentCoord` interface exists in `plugin.go:174-194` with `Dispatch`, `Await`, `Parallel`. The interface is never called from the engine. `WithCrewStyle()` and `WithGroupChat()` are no-ops at runtime.
- `PlanStep` (`agent.go:60-67`) carries an `ID` and `Status` but no `ParentID`. There is no way to construct a tree in the event log even if you wanted to.
- `Event` (`agent.go:21`) carries no `ParentEventID`, `ParentSessionID`, `CausalityToken`, or any hierarchical namespace.

So the claim "sub-agents emit in the same stream with hierarchical namespace" is **literally a non-existent feature dressed up as a feature.** The "hierarchy" is a string field in a struct nobody writes to.

**Why it matters.** The `CrewCoord` and `GroupChat` plugin options are advertised in the README/framework-analysis. A user who picks `WithCrewStyle()` will silently get a single-agent loop. There is no warning, no error, no fallback.

**Fix.**
- **Either implement it.** `Event` needs `ParentSessionID *uuid.UUID` and `ParentEventID *int64`. `loop()` needs a `Step` value that's a `[]int` (path) rather than `int`. `SubAgentCoord.Dispatch` needs to be called from somewhere — `loop()` is the obvious place, gated on a `HandoffPolicy`.
- **Or remove the misleading claims.** Delete `WithCrewStyle()`, `WithGroupChat()`, `EventSubagent`, the `SubAgents` field of `plugin.Config`, and the framework-analysis.md section that claims sub-agents ship. Be honest that the engine is a single-agent loop with a stub sub-agent interface.

There is no third option that keeps the README and the code in the same universe.

---

## 8. HIGH — `AGUIStreamer.Format` leaks engine internals; AG-UI state deltas are wrong

**File:** `internal/plugin/agui.go:28-91`, `internal/core/agent.go:34-44`, `internal/core/llm.go:95-114`

`AGUIEvent.Payload` carries the raw `map[string]interface{}` from the Anvil event. For `think.chunk`, the AG-UI spec requires:

```
{ "type": "TEXT_MESSAGE_CONTENT", "messageId": "...", "delta": "..." }
```

Anvil emits:

```
{ "type": "TEXT_MESSAGE_CONTENT", "run_id": "...", "payload": {"delta": "tok"} }
```

The AG-UI client has to know that the delta is in `payload.delta` rather than top-level. That's a contract breakage that a real frontend will fail to parse.

`think.start` / `think.chunk` / `think.end` map to a *single* `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` pair. The AG-UI spec has `MESSAGE_START` and `MESSAGES_SNAPSHOT` to begin with — Anvil never emits those, so the client doesn't know the message ID. The frontend can only concatenate deltas, not display them as a typed message.

`tool.call` → `TOOL_CALL_START` (OK), but there's no `TOOL_CALL_ARGS` (Anvil folds args into the start). The spec expects args to stream in.

**Why it matters.** The "AG-UI sits on top" claim (`README:54`, `best-of-breed.md:97`) is half-true. The engine emits *something* AG-UI-shaped, but a real CopilotKit frontend will misrender it. This is a hand-rolled, untested wire format. The single test (`plugin_test.go:11-52`) only checks "the type is non-empty" — it does not check the AG-UI spec compliance of any field.

**Fix.**
- Either run Anvil's `AGUIStreamer.Format` against an actual CopilotKit client and fix the spec violations (messageId generation, `TOOL_CALL_ARGS`, `STATE_SNAPSHOT` shape).
- Or rename to `AnvilSSEStreamer`, write your own frontend, and stop claiming AG-UI compatibility. The current state is the worst of both worlds.

---

## 9. MEDIUM — EventStore.Stream is unbounded and never closes the producer side

**File:** `internal/core/store_memory.go:58-77`, `internal/core/store.go:20`

```go
func (s *InMemoryEventStore) Stream(ctx context.Context, sessionID uuid.UUID, afterEventID int64) (<-chan Event, error) {
    ch := make(chan Event, 64)
    go func() {
        defer close(ch)
        s.mu.RLock()
        list := make([]Event, len(s.events[sessionID]))
        copy(list, s.events[sessionID])
        s.mu.RLock()  // bug: RUnlock
        for _, e := range list {
            if e.ID > afterEventID {
                select {
                case ch <- e:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return ch, error
}
```

Bugs and smells:
- `s.mu.RLock()` is called twice and `RUnlock` once. The second call will deadlock on the writer side. Test won't catch it because no test holds a writer concurrently.
- "Stream" is misnamed. It replays the snapshot then **closes**. There is no live-tailing. The `EventStore.Stream` interface contract is not specified — a Postgres implementation would have to make up semantics.
- Channel buffer is 64, same drop-on-saturation problem as `Sub` had before. Different code path, same trap.

**Why it matters.** The "Since" and "Stream" methods are the foundation of the resume-by-cursor story. If they don't work for `?since=N`, the reconnect path silently misses events.

**Fix.**
- Document `EventStore.Stream` precisely: "Returns events in order, written before the call returned. Closes after the most recent durable event at call time. Does not include events appended after the call."
- Implement a separate `EventStore.Subscribe` for live-tailing with proper cursor + backpressure.
- Fix the RLock/RUnlock double-call.

---

## 10. MEDIUM — Slow subscribers lose events silently; counter exists but nobody surfaces it

**File:** `internal/core/emit.go:42-52`, `internal/plugin/agui.go` (no use of `Sub.Dropped()`)

```go
// internal/core/emit.go:42
select {
case sub.ch <- e:
default:
    atomic.AddUint64(&sub.dropped, 1)
    if s.onSlowSubscriber != nil {
        s.onSlowSubscriber(sub, e)
    }
}
```

The drop counter is incremented. The hook is wired in `newSession` and `loadSession` (`store.go:78-81, 110-112`) as a stub that does nothing. The AG-UI streamer doesn't expose the drop count. The SSE client can't tell the engine "go slower" or "send me a gap marker."

**Why it matters.** Frontends that render markdown or run layout on the main thread will, under load, miss events. They will see a half-rendered assistant message and a tool call that "never resolved." The user concludes the agent is broken. The operator concludes the frontend is broken. Nobody concludes the engine dropped events, because nothing tells them.

**Fix.**
- Emit an explicit `subscriber.dropped` event when `sub.dropped` increments past a threshold (say 5 events in 1s). The frontend can render "skipping ahead" and request a resync via `?since=`.
- Add an SSE heartbeat (`event: ping`) on idle so reverse proxies and load balancers don't kill the connection.

---

## 11. MEDIUM — Checkpoint cadence is wrong: `s.State.Step%s.cfg.CheckpointEvery == 0` skips step 0

**File:** `internal/core/agent.go:211-213`, `internal/plugin/checkpoint.go:20-22`

```go
// internal/core/agent.go:211
if s.State.Step%s.cfg.CheckpointEvery == 0 {
    s.checkpoint()
}
```

Step is incremented *after* the emit (`s.State.Step++` at line 206). So:
- Step 0 runs (LLM thinks, tool executes, state mutates, then Step becomes 1).
- `1 % 5 == 1` → no checkpoint.
- Step 5 runs, becomes 6 → no checkpoint (`6 % 5 == 1`).
- Step 10 runs, becomes 11 → no checkpoint.

The `StepCheckpoint` policy in `plugin/checkpoint.go:20` is `step - lastCheckpoint >= Every` (correct), but the engine **doesn't use it** — the engine uses a hardcoded modulo on the *post-increment* step. The plugin interface is decorative.

**Why it matters.** The first few steps and the last few steps of any session are unprotected. If the process dies at step 3, the resume restarts from the empty state. If at step 4 (the only step before step 5's checkpoint), the resume is correct because the *initial* checkpoint was saved in `newSession` (`store.go:84`) — but only because there's a separate Save call. The modulo check is dead code with the wrong semantics.

**Fix.** Use the `CheckpointPolicy` interface already defined. Wire it into `loop()`:

```go
if s.cpPolicy != nil && s.cpPolicy.ShouldCheckpoint(s.State.Step, s.lastCheckpoint, lastEvent) {
    s.checkpoint()
    s.lastCheckpoint = s.State.Step
}
```

Default to `NewStepCheckpoint(5)` in `New()`. The current code is doing what the plugin would do, badly, and ignoring the plugin entirely.

---

## 12. MEDIUM — `ContextManager.Pack` is racy and its summarization is destructive

**File:** `internal/core/context.go:50-81, 88-133`

```go
// internal/core/context.go:50
func (cm *ContextManager) Pack(s State) []Message {
    cm.mu.Lock()
    defer cm.mu.Unlock()
    ...
}
```

`Pack` takes `State` by value. It locks the `ContextManager` (its own internal mutex), not `s.mu`. So:
- `loop()` reads `s.State` *without* holding `s.mu` in `think()` (`agent.go:189` and `llm.go:80`). `think()` is not the lock holder; `s.State` is mutated by other goroutines.
- The `CacheKey()` call inside `CacheKey()` is not actually race-safe against the `s.State` reader because `Pack` does not protect against concurrent state mutation.
- `MaybeSummarize` mutates `s.History` in place (`s.History = s.History[30:]`) while `Pack` is iterating a snapshot — fine for the copy, but the *next* `Pack` will see the truncated history. If two `think()` calls run concurrently (which they don't, but `WithSpeculation()` implies they will), they will race on the truncation.

`summarizeInto` (`context.go:115-133`) is a "stub" that concatenates strings. Calling it "lazy summarization" is generous — it's "lazy about not implementing summarization." The 5k char cap (`context.go:130`) silently truncates the summary. An agent that runs for 200 steps will have a long-term summary that is the *most recent* 5k chars of concatenated turns, not a summary at all.

**Why it matters.** This is the part of the engine that decides what the LLM sees. Get it wrong and the LLM hallucinates, doubles work, or loses context. The current implementation is a placeholder.

**Fix.**
- Make `Pack` take a `*State` and lock `s.mu.RLock()` for the duration. Hold the read lock through the LLM call too (you're reading `s.State` to build the request — it shouldn't change under you).
- Implement actual summarization via the LLM. The router is already injected into the engine. Use it.
- Rename `s.LongTerm` to `s.LongTermSummary` so the truncation behavior is at least visible in the name.

---

## 13. MEDIUM — `Resume()` does not resume; it spawns a new `loop()` and re-emits

**File:** `internal/core/agent.go:151-165`, `internal/core/store.go:91-116`

```go
// internal/core/agent.go:151
func (a *Agent) Resume(ctx context.Context, sessionID uuid.UUID) (*Session, *Sub, error) {
    sess, err := a.loadSession(ctx, sessionID)
    ...
    sub := sess.Stream("primary")
    sess.emit(Event{
        SessionID: sess.State.SessionID,
        Type:      EventSessionStart,
        Payload:   map[string]interface{}{"resumed": true, "from_step": sess.State.Step},
    })
    go sess.loop()
    ...
}
```

`loadSession` (`store.go:91`) loads the checkpoint into `sess.State`. Then it spawns a fresh `loop()`. The loop will:
1. Re-think from the loaded state (the LLM has the history, so this might be fine).
2. Emit `tool.call` for the *same tool with the same args* as the step that was mid-execution when the engine died.
3. Hope the idempotency cache returns the right value.

If the idempotency cache is in-memory (the default — `cache_memory.go`) and the process restarted, **the cache is empty**. The tool re-executes. If it's a non-idempotent tool ("send email"), the user gets two emails.

If the process did not restart (e.g., user closed the tab and reopened), the cache is alive and the resume works. The behavior is silently different across two scenarios that look identical to the user.

**Why it matters.** Resume is the *headline* feature. It's a coin flip whether it works on any given deployment.

**Fix.**
- Persist the idempotency cache alongside the checkpoint, or at least key it on `session_id` in Postgres with the same TTL.
- On `Resume()`, replay events from the event log *since the last checkpoint*, not just re-think. This is what "event-sourced" means in practice. The `AsyncEventWriter` makes this impossible today (events are not durable at the time they're emitted, so replay can miss them); it's another reason Finding #1 is critical.
- Test this: write a test that pauses a session mid-tool-call, kills the engine, restarts, calls `Resume`, and asserts the tool was *not* re-executed. There is no such test today.

---

## 14. MEDIUM — `State.ToolRegistry` exists, is never used, and the type signature is broken

**File:** `internal/core/agent.go:55`, `internal/core/store.go:67, 106`

```go
// internal/core/agent.go:48
type State struct {
    ...
    ToolRegistry map[string]Tool `json:"-"`  // not serialized
    ...
}
```

`Tool` is an *interface*. A `map[string]Tool` containing concrete tool types (e.g., `*CalculatorTool`) cannot be meaningfully JSON-serialized — even with `json:"-"`, the moment this is copied across a process boundary (the `cp.Save` path uses the database), the type information is lost. The field is *only ever* on the in-process `State` struct. It's never assigned (grep `ToolRegistry =` → 0 hits outside the struct).

**Why it matters.** Dead code. The reader assumes the engine has a way to save+load tool definitions, but it doesn't. The field is a hint of an intent that never shipped.

**Fix.** Delete `ToolRegistry` from the struct. Tools are process-level configuration, not session state.

---

## 15. LOW — `pickModel` is a constant; `LLMRequest.Model` is decorative

**File:** `internal/core/llm.go:127-129`, `internal/core/llm.go:81-90`

```go
// internal/core/llm.go:127
func (s *Session) pickModel() string {
    return "claude-sonnet-4-5"
}
```

Hardcoded. The "router may override" comment (`llm.go:126`) is the only acknowledgment that the router might want to do something. There is no model cascade, no cost-vs-quality switch, no "use Haiku for step 0 to summarize then Sonnet for step 1 to answer." The README claims model cascade as a key feature (`llm.go:9`).

**Fix.** Either delete the claim or implement it. `pickModel` should consult a `ModelRouter` policy interface that returns a model name based on the step and prior history.

---

## 16. LOW — `EventSubagent`, `NewMCPSource`, `NewCrewCoord`, `NewGroupChat`, `NewSpeculator` are package-level function pointers that are never assigned

**File:** `internal/plugin/plugin.go:267-273`

```go
var (
    NewMCPSource     func(endpoint string) ToolSource
    NewCrewCoord     func() SubAgentCoord
    NewGroupChat     func() SubAgentCoord
    NewCodeExecTools func(sandbox Executor) ToolSource
    NewSpeculator    func() Speculation
)
```

These are *uninitialized function variables*. Calling `anvil.WithCrewStyle()` triggers `NewCrewCoord()` which will *nil-panic*. The plugin options exist purely as documentation of intent. A user who calls them in good faith gets a segfault, not an error.

**Why it matters.** This is a foot-gun masquerading as a public API.

**Fix.** Either ship the implementations in this package, or move the `Option` constructors to the plugin pack modules and remove them from `plugin.go`. Do not ship uninitialized function variables in a public API.

---

## 17. LOW — `tools_builtin.go` calculator uses `fmt.Sscanf` for arithmetic

**File:** `internal/core/tools_builtin.go:36-58`

`fmt.Sscanf("2 + 3", "%f %c %f", &a, &op, &b)` fails on `2+3` (no spaces), `2 + 3.0`, `(2+3)`, `2^3`. The comment ("Lazy: only handles two-operand expressions for the demo") is honest. The dishonest part is shipping it as `DefaultTools()` — every user who calls `core.New(core.WithTools(core.DefaultTools()))` gets a calculator that fails on 90% of inputs.

**Why it matters.** This is the *only* concrete tool in the engine. The README's "2 + 3" example (`README:76`) happens to be the one input that works. Anyone who tries `2+3`, `2*3`, or `(1+1)*2` gets a tool error and a confused LLM.

**Fix.** Either delete `DefaultTools()` and make the user register their own, or use a real expression parser (10 lines with `goexpr` or `expr-lang/expr`).

---

## 18. LOW — `EventStore` interface is missing a "list sessions" or "delete session" method

**File:** `internal/core/store.go:16-21`

`Since`, `GetByID`, `Stream` exist. There's no `List`, no `Delete`, no `Truncate`, no `LatestSeq(sessionID)`. A user building a UI to browse past sessions cannot do it through the engine interface. They'll reach for the database directly, which couples them to Postgres specifics — defeating the engine/plugin boundary the architecture is so proud of.

**Fix.** Add `List(ctx, sessionIDPrefix, limit) ([]SessionMeta, error)` and `Truncate(ctx, sessionID, beforeEventID) (deleted int64, err error)`. Document the retention policy as a first-class concern.

---

## 19. LOW — `store_memory.go` `Since` filter is `> afterEventID`, off-by-one with `Stream`

**File:** `internal/core/store_memory.go:30-44, 67`

`Since(afterEventID=N)` returns events with `ID > N` (line 36). `Stream(afterEventID=N)` returns events with `ID > N` (line 67). Both treat `afterEventID` as "give me the next one after this." But the SSE standard (and the README's `Last-Event-ID` claim) treats the ID as "the last one I got" — so the next one to send is `ID > N`. Coincidentally correct, but the documentation is wrong: `Since(0)` should return event ID 1, not 0; `Since(1)` should return ID 2, not 1. There is no test for the boundary.

**Why it matters.** Off-by-one in cursor semantics. A real client reconnecting with `Last-Event-ID: 42` will either miss event 43 (if the engine implements "after" as "≥") or replay event 42 (if it implements "after" as "≤ N+1"). Pick one and test it.

**Fix.** Document the semantics in the interface comment. Add a boundary test.

---

## 20. LOW — `RunRecord` is declared in `plugin` but never written by the engine

**File:** `internal/plugin/run_record.go:16-27`, `internal/core/agent.go` (no write path)

```go
type RunRecord struct {
    ThreadID    string                 `json:"thread_id"`
    Step        int                    `json:"step"`
    StateRef    string                 `json:"state_ref"`
    Action      Action                 `json:"action"`
    Observation map[string]interface{} `json:"observation,omitempty"`
    Cost        float64                `json:"cost_usd"`
    Tokens      TokenUsage             `json:"tokens"`
    Latency     time.Duration          `json:"latency"`
    PluginName  string                 `json:"plugin_name"`
    Timestamp   time.Time              `json:"timestamp"`
}
```

The `best-of-breed.md` doc says (line 91):
> "Canonical Run Record — every plugin writes `Run{ThreadID, Step, StateRef, Action, Observation, Cost, Tokens, Latency}`."

Grep `RunRecord{` in the `core/` directory → 0 hits. The engine doesn't write one. The plugins don't write one. The `TestRunRecord_BasicShape` test (`run_record_test.go:42-69`) only checks that the *struct literal* has the right fields. It never goes through a code path that produces a `RunRecord`.

**Why it matters.** "Canonical run record" is the *other* competitive moat besides resumability. Without it, `anvil replay` and `anvil inspect` (advertised in `best-of-breed.md`) cannot be built. The data isn't there.

**Fix.** Add a `recordWriter` field to `Session`. In `loop()`, after each step, build a `RunRecord` and enqueue it. Persist via a separate `RecordStore` (or alongside the event log). Now `anvil replay` is a query, not a feature.

---

## Cross-cutting assessment

### Is the event-sourced architecture competitive?

**Conditional yes, today no.** The thesis (Postgres as source of truth, replay to resume, event log for observability) is sound and is the only one in the Go ecosystem. But the code is two refactors short of delivering it:

- `AsyncEventWriter` decouples durability from the loop, so the log is no longer the source of truth.
- `Resume()` re-thinks instead of replays, so resume is "try the same thing again" not "replay from last durable state."
- `RunRecord` is documented but unwritten, so the audit/replay story is paper.

The *latent* competitive position is good. The *shipped* position is "AG-UI with extra steps."

### Are there race conditions, ordering issues, or consistency problems?

Yes, several. Most serious:
- **Drop-on-slow-subscriber + no gap marker** (Findings #1, #10) — events can vanish from a live stream and the consumer cannot detect it.
- **Async write + sync read on `Since`** (Findings #1, #9) — `?since=N` can return fewer events than actually exist, because the events after N are not yet durable.
- **Idempotency key on raw JSON** (Finding #6) — model reorders keys, cache misses, side-effects fire twice.
- **State mutation outside the lock** (Finding #12) — `think()` reads `s.State` without `s.mu`, but `loop()` mutates it. Single-goroutine today, races the moment sub-agents ship.
- **State.ToolRegistry** (Finding #14) — type erasure across boundaries.

### Does the multi-consumer claim actually work?

In-process: yes, *with the caveat* that subscribers can drop events without notification.
Cross-process: **no.** There is no broker, no cross-node fanout, no per-consumer cursor store, no HTTP/gRPC adapter that lives in the engine.

### Does sub-agent hierarchy actually solve the problem?

**Not implemented.** `EventSubagent` is a constant. `SubAgentCoord` is an interface with no callers. `WithCrewStyle()` is a foot-gun (Finding #16). A "hierarchy" is a string in a struct nobody writes to.

### Could the frontend tools claim be implemented without protocol work?

No. The reverse channel is the protocol. Without a `POST /sessions/{id}/tools/{request_id}` endpoint, the frontend can only observe tool calls, not drive them.

### Is the Go runtime advantage real?

**For cold start and memory: yes.** A Go binary starts in ~10ms, lives in 20MB, runs on a $4 VPS. Python alternatives (LangGraph, AutoGen, CrewAI) need 200-500ms cold start and 200MB+ resident. For a CLI or a sidecar process, this is real.

**For concurrency: no, not yet.** The `loop()` is a single goroutine. Sub-agents are stubs. The `WaitGroup` test (`agent_test.go:149`) is a placeholder. The advantage is in the language; the code doesn't use it.

### What edge cases break the design?

In rough order of how soon you'll hit them:
- **Network blip + reconnect** (Finding #3) — multi-consumer cross-node, broken.
- **Slow frontend** (Finding #10) — events silently dropped.
- **Tool re-execution on resume** (Findings #6, #13) — side effects fire twice.
- **Concurrent sessions on shared sub-agent** (Findings #4, #7) — doesn't exist yet.
- **Long session, summary truncation** (Finding #12) — "summary" is the last 5k chars of concatenated turns.
- **Postgres slow / unavailable** (Finding #1) — events are queued in 4096-slot buffer, then silently dropped.
- **Process restart mid-tool-call** (Finding #13) — tool re-executes, side effect fires twice.
- **Tab refresh mid-LLM-stream** (Finding #5) — frontend re-asks, engine re-runs the same think cycle.

---

## What "fix the top 10" would actually look like

If I had to pick 10 from this list, in order of leverage:

1. **#1** — Decide the durability model. Drop `AsyncEventWriter` or make it transactional.
2. **#2** — Assign sequence numbers in `emit()`. Make `EventID` real. Test it.
3. **#3** — Pick a broker and define the `Consumer` interface. Replace `EventStore.Stream`.
4. **#5** — Either implement the reverse channel for frontend tools or remove the claim.
5. **#6** — Canonicalize args for the idempotency key. Test with reordered JSON.
6. **#7** — Implement `SubAgentCoord` or delete the plugin options. Stop advertising a non-existent feature.
7. **#13** — Make `Resume()` replay events from the log, not re-think.
8. **#10** — Emit a `dropped` event on subscriber saturation, or close the channel and force a reconnect.
9. **#11** — Wire `CheckpointPolicy` into `loop()`. Remove the modulo.
10. **#20** — Make `RunRecord` real. Persist it. Then `anvil replay` is a feature, not a paragraph in a design doc.

The pattern across all ten: **make the engine do what the docs already claim.**

---

## Closing note for the synthesis step

The `framework-analysis.md` and `best-of-breed.md` are excellent as *market positioning* — they correctly identify that no one in the agent-framework space treats resume as first-class and no one is doing Go. The architecture is the right one.

The implementation is at the "first 30% of a real system" point: the loop runs, the events flow, the checkpoints save, the tests pass. The remaining 70% is the boring distributed-systems work — durability semantics, cursor protocols, outbox patterns, sub-agent lifecycles, plugin contract enforcement, real test coverage of failure modes.

The competitive position is real but the moat is currently 1-2 quarters of solid engineering. The design is not the differentiator. The execution will be.
