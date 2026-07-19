# Critique B — Cross-Service Sync + State-Patch Protocol

**Reviewer:** senior distributed systems / real-time collaboration architect
**Scope:** Anvil (Go engine, React SDK) — bidirectional state sync, state-patch protocol, HITL approval flow, cross-service event fanout
**Date:** 2026-07-19

---

## 0. Executive Summary

The current design assumes **a single Go process** that owns (a) the in-memory `Session` map, (b) the `ApprovalRegistry`, (c) the `ThreadStore`, and (d) the SSE broadcast loop. The moment you split "engine" from "HTTP API" — which the user explicitly asked about — **the entire control plane breaks**, not just the event bus:

| Current assumption | Breaks when API ≠ engine |
|---|---|
| `Server.sessions[uuid]` is a Go map | API server's map is empty for sessions owned by engine process |
| `Server.approvals.Respond(...)` writes to a Go channel | Engine never wakes up; agent hangs until `Deadline` |
| `handleRunThread` calls `s.agent.Run(...)` in-process | No engine process to call |
| `handleThreadStream` subscribes via `sess.Stream(...)` | No in-process session to subscribe to |
| `handlePatchState` updates DB but never fans out | Peers never see other users' edits |
| `AsyncEventWriter.seq` is per-process | Multiple engine instances collide on event IDs |

**Verdict on the state-patch format itself:** the RFC 6902 subset is fine, but the implementation is too coarse (`ComputeStatePatch` replaces whole `Plan`/`Scratchpad` on any change), `From`/`To` are placeholders with no real concurrency control, and there is no broadcast path. The React SDK has no abstraction for thread state at all — only session events — so the "user A and user B editing the same plan" question is unanswerable today.

**Top three production-readiness gaps:**

1. **No cross-service event bus** — the engine can't talk to the API, the API can't broadcast, the approval channel doesn't survive a process boundary.
2. **State patches are a write-only API** — they mutate Postgres but never appear on the SSE stream, so multi-user collab is impossible.
3. **No versioned concurrency** on state patches — concurrent edits to `/plan/2/status` will silently last-write-win with no detection, no merge, no notification.

Recommendations are at the bottom (§7). Everything between is the analysis.

---

## 1. Cross-Service Synchronization

### Layout the user described

```
 ┌──────────┐      ┌─────────────┐      ┌──────────┐
 │ Frontend │ HTTP │ HTTP/API    │ RPC  │ Agent    │
 │ (React)  │◀────▶│ service     │◀────▶│ engine   │
 └──────────┘ SSE  └──────┬──────┘      └────┬─────┘
                          │                 │
                          ▼                 ▼
                     ┌────────────────────────┐
                     │ Postgres (events, ckpt,│
                     │  threads, scratchpads) │
                     └────────────────────────┘
```

Two real services (API + engine) plus the browser. The question: when the engine emits a `think.chunk` event, how does it reach the React frontend? Five options:

### (a) API server polls the engine

- **Mechanism:** API does `GET /engine/sessions/{id}/events?since={last}` every 200–500 ms.
- **Pros:** trivial; no infra; works across any deployment.
- **Cons:** tail latency equals poll interval; chat UX will feel "chunky" at 500ms RTT. Per-thread poll fan-out: 1k users = 1k pollers = 1k queries/interval.
- **Verdict:** ❌ reject for live chat. Acceptable as a *fallback* for low-frequency updates (e.g., a "background tasks" view), not for streaming.

### (b) Engine pushes to API server over a persistent connection (gRPC stream, WebSocket, raw TCP)

- **Mechanism:** engine holds an outbound bidi stream to the API, fans events in. The API's existing SSE handler stays the same — it just consumes from an inbound channel fed by the engine stream instead of an in-process `Session`.
- **Pros:** lowest latency; works over a single connection; gives the API an immediate hook for backpressure, drop tracking, and a `subscriber.dropped` event when the API→browser leg is slow.
- **Cons:** requires a connection registry, reconnect logic, and a `sub.Unsubscribe` round trip; deploys get harder (mutual TLS, service mesh, etc.).
- **Verdict:** ✅ **best for the API→engine hop** when latency matters and volumes are moderate (<10k concurrent sessions per API pod). This is what Temporal, Cadence, and Replit do.

### (c) Shared Postgres LISTEN/NOTIFY

- **Mechanism:** engine `NOTIFY events_session_<id>, '<jsonb>'` on every `Append`. API process does `LISTEN events_session_<id>` for the sessions its SSE clients are subscribed to. The event log table remains the source of truth.
- **Pros:** zero extra infra; survives restarts; events are already in the table (no double write); ordering is naturally preserved per-session; reconnection is automatic (Postgres re-establishes LISTEN on client reconnect).
- **Cons:** payload limit is 8000 bytes (use the `payload` column for the body and send only `{id, type}` via NOTIFY); requires per-session channels or a shared channel with filtering; 1k subscribers × per-event notify overhead.
- **Verdict:** ✅ **best default for the API→engine hop.** Pair with (b) only if you outgrow it. The current `PostgresEventStore.Stream` already polls every 100ms (store_postgres.go:117) — the comment even says "swap for LISTEN/NOTIFY at scale." Now is the time. Concrete schema:

  ```sql
  CREATE OR REPLACE FUNCTION notify_event() RETURNS trigger AS $$
  BEGIN
    PERFORM pg_notify('anvil_events', NEW.id::text || ':' || NEW.session_id::text);
    RETURN NEW;
  END $$ LANGUAGE plpgsql;
  CREATE TRIGGER events_notify AFTER INSERT ON events
    FOR EACH ROW EXECUTE FUNCTION notify_event();
  ```

  The API pod subscribes once, filters by session_id in-process.

### (d) Redis pub/sub

- **Mechanism:** engine publishes on `anvil:session:<id>`; API subscribes.
- **Pros:** higher throughput than Postgres NOTIFY; built-in fanout; many client libraries.
- **Cons:** messages <1MB only; no replay (fire-and-forget) — you need Redis Streams or Postgres for Last-Event-ID resume; new infra dependency; ordering is best-effort (cluster mode).
- **Verdict:** 🟡 viable for very high volume (>10k concurrent/svc) but you still need Postgres for the event log anyway, so you're adding infra for a one-leg win.

### (e) Kafka / NATS / Pulsar

- **Verdict:** ❌ **massively overkill.** The unit of work is one human-sized session, not billions of events per second. Kafka's design (replicated log, consumer groups, partitions) buys you nothing here. NATS JetStream could be reasonable at extreme scale, but the operational burden is unjustified until you're at least 100k concurrent sessions.

### Recommended architecture

```
                 ┌────────────────────────────┐
   Engine  ──▶   │  Postgres event log        │  (source of truth)
                 │  + LISTEN/NOTIFY trigger   │
                 └────────┬───────────────────┘
                          │ NOTIFY
                          ▼
                 ┌────────────────────────────┐
                 │  API service (SSE bridge)  │  ◀── HTTP/WS from browser
                 │  - LISTEN per session      │      holds short-lived gRPC
                 │  - gRPC bidi to engine     │      stream to engine for
                 │    for tool/approve reverse│      tool/approve replies
                 └────────────────────────────┘
```

- **Engine→API:** Postgres LISTEN/NOTIFY (option c) for the event fanout, with a gRPC stream to the engine (option b) only for the *reverse* channel — tool results, approval responses, state patches.
- **API→browser:** SSE stays exactly as it is. The `sub` channel just becomes a thin wrapper over a `LISTEN` consumer.
- **Browser→API:** HTTP/SSE stays.
- **This means the API and engine share state through the database, not memory.** All the in-process Go maps (`Server.sessions`, `Server.approvals`) need to die. Approval gates move into a Postgres table (or Redis key with a `LISTEN`). Sessions move to a Postgres enum. Tool-call reverse channel becomes a gRPC stream or a Postgres `NOTIFY` reply queue.

---

## 2. Eventual Consistency of State-Patch

### Current model

```go
// handlePatchState (server.go:208)
newState, err := core.ApplyStatePatch(t.State, patch)
t.State = newState
s.threads.Update(r.Context(), t)
writeJSON(w, http.StatusOK, threadToResp(t))
```

The patch is applied, persisted, returned to the *patching* client. **No broadcast.** The second user never learns their peer edited the plan.

### What the model should be

A state patch is an event, just like `think.chunk`. It needs three things:

1. **A monotonic thread-version** so any client (current or future) can detect drift.
2. **To be appended to the event log** so resume/replay shows the change.
3. **To be broadcast** to all SSE subscribers of the thread.

```go
// Sketch
type ThreadStateEvent struct {
    ID          int64     // event log id
    ThreadID    uuid.UUID
    Version     int64     // monotonic per-thread, bumped per accepted patch
    Patch       StatePatch
    FromVersion int64     // version this patch was based on
    ActorID     string    // user who issued it
    CreatedAt   time.Time
}
```

Server pseudocode:
```
on PATCH /threads/:id/state:
  BEGIN
    patch = decode(body)
    current = SELECT state, version FROM threads WHERE id = $1
    if patch.from_version and patch.from_version != current.version:
       return 409 CONFLICT {current_version, current_state, patch}
    new_state = apply(current.state, patch)
    new_version = current.version + 1
    UPDATE threads SET state=$2, version=$3 WHERE id=$1
    INSERT INTO thread_events (...) VALUES (...)
    COMMIT
  NOTIFY anvil_thread_<id>, '{"version": ..., "patch": ...}'
  return 200 {state, version}
```

The NOTIFY wakes every API pod with subscribers; each one writes an SSE event to its own listeners.

### Why not CRDT or OT?

- **OT (Operational Transform):** the right tool for character-level concurrent text editing (Google Docs). Anvil's state is structured, not a string — patches target JSON paths. OT doesn't compose well with hierarchical paths.
- **CRDT (Yjs, Automerge):** the right tool for offline-first P2P. Adds a 2–10x size overhead per change and a merge algorithm the team has to maintain. Anvil's concurrent writers are *human users on a UI* — a "first load wins, server resolves, then broadcast" model is simpler.
- **Recommendation:** **server-authoritative with optimistic concurrency control (OCC) via `FromVersion`**. That's the right fit for "two humans looking at the same agent plan, one edits, the other sees it." It's also what every team-tool you've used (Linear, Notion, Figma pre-CRDT) does.

---

## 3. Optimistic Updates + Conflict Resolution

### Concrete scenario

User A and User B both see `/plan/2/status = "in_progress"`. Both PATCH `/plan/2/status = "done"` within 50ms of each other.

### Today's behaviour (with my recommendation from §2)

- A's PATCH: `from_version=N`, server has version `N`, applies, version becomes `N+1`, broadcast.
- B's PATCH: `from_version=N` (stale), server has version `N+1`, **409 CONFLICT** with the current state and version.

B's client should:
1. Re-fetch the thread (or apply the broadcast it missed).
2. Show "Alice just marked this done. Your edit conflicts." UX.
3. Either auto-rebase the patch on top of `N+1` and retry, or surface a merge UI.

For the *agent* use case, almost every conflict scenario looks like:
- Agent changes `/status = "running"` while a human changes `/plan/2/status = "done"`.
- These don't actually conflict (different paths).
- The state-patch format's `/plan/2/status` paths mean conflicts only happen when *two writers target the same path*.

### What the agent's loop should do

The engine itself writes to `state.Status`, `state.CurrentStep`, `state.TokensUsed`, `state.CostUSD`, and `state.LastObservation`. The frontend writes to `state.Plan` and `state.Scratchpad`. **Today there is no enforcement of this division in `handlePatchState` (server.go:208)** — any authenticated writer can PATCH `/last_observation` and corrupt the agent's view. The handler must:

```go
// In handlePatchState, before applying:
allowedForFrontend := map[string]bool{
    "/plan": true, "/plan/0": true, "/plan/1": true /* etc */,
    "/scratchpad": true, "/scratchpad/*": true,
}
for _, op := range patch.Ops {
    if !isPathAllowedForActor(op.Path, actor) {
        return 403 forbidden
    }
}
```

Where `isPathAllowedForActor` says: "if the actor is a human, only plan and scratchpad are writable; if the actor is the engine, only status/step/tokens/observation are writable." (Engine writes go through a different path: a service-account-signed internal API, or a header `X-Anvil-Actor: engine`.)

### Verdict

- **No vector clocks needed.** Patch paths are coarse-grained and rarely concurrent.
- **No last-writer-wins without detection** — that loses user intent silently. OCC with explicit 409 is correct.
- **Fronted by UI:** the React hook should treat 409 like a TanStack Query conflict — rebase or surface a toast, not crash.

---

## 4. Bidirectional Sync Edge Cases

### What "bidirectional" means here

There are two independent directions in the SDK:

1. **Server → client (events):** think.chunk, tool.call, state.patch. Authoritative; never optimistic.
2. **Client → server (writes):** startTask, deliverToolResult, patchState, approve. Latency-sensitive for UX.

### Current React state model

- `useSession` keeps `eventCount` and `lastEventId`. It is **not a state model** — it's an event counter.
- `useEvents` is `useState<AnvilEvent[]>` with `setEvents((prev) => [...prev, e])` on every event. **O(n) per event, full re-derive in `useChat`.**
- There is no `useThreadState` hook at all. The thread-state model isn't even represented in the SDK.

### Right model: TanStack Query for thread state, plain reducer for events

```
┌─────────────────────┐
│  ThreadQuery        │   TanStack Query — server-authoritative, OCC,
│  (server is truth)  │   refetch on focus, optimistic on PATCH,
│                     │   409 → invalidation + rebase
└──────────┬──────────┘
           │ patches flow through
           ▼
┌─────────────────────┐
│  EventLog           │   Zustand or useReducer — append-only,
│  (immutable log)    │   indexed by id, useChat computes
│                     │   messages by single pass at end
└─────────────────────┘
```

**User types a message:**
- Optimistic: append to `EventLog` with a temp id + `pending: true`, render immediately.
- PATCH `/threads/:id/state` with `/scratchpad/pending_input` = text.
- On 200, mark the temp event as `pending: false`, capture `version`.
- On 409, re-fetch thread state, surface conflict, re-apply on top.

**Agent responds:**
- Server is source of truth. The event arrives, you append to the log. No rebase. No conflicts. Trust the seq number.

**For a chat input box specifically:** the input field's text is **local React state** (`useState` in the input component). It should NOT be in the thread state at all until the user hits send. A scratchpad entry called `pending_input` is a code smell — that's the input component's job.

### Why not full Replay?

Replay (à la redux) is for time-travel debugging. For a chat UI, you just need a log you can re-derive. The reducer pattern in `useChat` (sdk/anvil-react-headless:333) is on the right track but the dependency on `events` array reference identity means every event re-derives all messages. Use a memo keyed on `events.length` plus a `Map<id, message>` index.

---

## 5. State-Patch vs Full State

### Current `ComputeStatePatch` (state_patch.go:53)

```go
// Plan: replace entirely (plans are usually small)
if !planEqual(from.Plan, to.Plan) {
    ops = append(ops, StateOp{Op: "set", Path: "/plan", Value: to.Plan})
}
// Scratchpad: replace entirely (small map)
if !mapEqual(from.Scratchpad, to.Scratchpad) { ... }
```

Two problems for the "200KB state, 10K history items" case:

1. **Plan replace-whole** means a single-line edit to one plan step sends the whole plan array. With 100 steps of ~500 bytes each, that's 50KB per edit instead of ~200 bytes.
2. **No partial scratchpad diff.** The whole map ships every time. A 10K-entry scratchpad has 200KB of churn per update.

### Right protocol: per-field diffs, lazy recursion, no full state

```go
// Recursive diff
func diff(a, b interface{}, path string) []StateOp {
    switch a := a.(type) {
    case map[string]interface{}:
        for k, vb := range b.(map[string]interface{}) {
            va, ok := a[k]
            if !ok { ops = append(ops, StateOp{Op:"add", Path: path+"/"+k, Value: vb}); continue }
            if !reflect.DeepEqual(va, vb) {
                if isObjectOrArray(va) && isObjectOrArray(vb) {
                    ops = append(ops, diff(va, vb, path+"/"+k)...)
                } else {
                    ops = append(ops, StateOp{Op:"set", Path: path+"/"+k, Value: vb})
                }
            }
        }
        for k := range a { if _, ok := b.(map[string]interface{})[k]; !ok {
            ops = append(ops, StateOp{Op:"del", Path: path+"/"+k})
        }}
    case []interface{}:
        // smart list diff: LCS-based or position-anchored
    }
}
```

For Plan, the list-diff should be LCS-based (Longest Common Subsequence) so a step insertion at index 3 produces one `add` and one `move`, not N shifts.

### Initial state vs deltas

- **First connect:** send full state as one `state.snapshot` SSE event. Cheaper than 1000 patches.
- **Subsequent:** deltas only. The SSE envelope looks like:
  ```
  event: state.snapshot
  data: {"version": 1, "state": {...}}
  
  event: state.patch
  data: {"version": 2, "from_version": 1, "patch": {...}, "actor": "user:abc"}
  ```
- **Compression:** yes, gzip the SSE body. nginx/Caddy/envoy do this with one line of config. Don't write custom compression in Go — `http.Flush` and gzip interact badly. Use an L7 proxy.

### When to ship a new snapshot instead of patches

- If the client has been disconnected more than the patch log retention window (e.g., > 1000 patches or > 1 hour).
- If the client explicitly requests one (`GET /threads/:id?full=1`).
- If a patch fails to apply on the client (corrupt state). The server can detect this via an SSE `ack` message and ship a full snapshot.

---

## 6. Reconnect + Missed Patches

### Today

`handleThreadStream` (server.go:305) takes `?since=N` and replays events from the log:
```go
missed, _ := s.events.Since(r.Context(), t.ID, sinceEventID, 1000)
for _, e := range missed { writeSSE(...) }
```

This works for *session events* because they have monotonic `id`. It does **not** work for *thread state* because:
- There is no `state_patch` event in the log (see §2).
- The client doesn't know the thread version it was last at.

### Required design

1. **Persist every accepted state patch as an event in the log:**
   ```sql
   CREATE TABLE thread_state_events (
     id          BIGSERIAL,
     thread_id   UUID,
     version     BIGINT NOT NULL,
     from_version BIGINT,
     patch       JSONB NOT NULL,
     actor_id    TEXT,
     created_at  TIMESTAMPTZ DEFAULT now(),
     PRIMARY KEY (thread_id, id)
   );
   ```
   Same log → same `?since=N` resume works.

2. **First reconnect message is a snapshot, not a patch:**
   ```
   GET /threads/:id/events?since=42&mode=reconnect
   → server detects: last client event id was N, last thread_state_event id was M
   → emits one state.snapshot, then continues with patches from M+1
   ```
   Why snapshot: the client may have been disconnected for hours; replaying 10K patches is silly. 200KB once is fine.

3. **Include a thread-version header on every SSE event:**
   ```
   id: 42
   thread_version: 17
   event: state.patch
   data: {...}
   ```
   The client uses `thread_version` to detect a missed patch (gap in monotonicity → trigger snapshot refetch).

4. **Server has a "durable up to" watermark:** the AsyncEventWriter today has a process-local `Drainable()` (async_writer.go:150) — for cross-service this must become a real Postgres-backed `MAX(id) FROM events WHERE session_id = $1` exposed via a `?wait_durable=N` query parameter on the SSE endpoint. Clients that need to be sure an event is durable (e.g., before a checkpoint) wait for the watermark.

5. **Reject patches with stale `from_version`:** see §3. The 409 response includes the current state so the client can rebase.

---

## 7. Recommendations (Prioritized)

### Must do (correctness)

1. **Move `Server.sessions`, `Server.approvals`, and the engine goroutine into Postgres + LISTEN/NOTIFY.** Anything that crosses a process boundary must not be a Go map. Specifically:
   - Approval gates → `pending_approvals` table with `LISTEN` on insert/update.
   - Session reverse channel (tool result, state patch) → gRPC stream from API to engine, or `NOTIFY` reply queue.

2. **Persist every accepted state patch as a `thread_state_event`** and broadcast it over SSE. Without this, multi-user collab is impossible.

3. **Add `from_version` OCC to `handlePatchState`** and return 409 on conflict with current state. Add server-side enforcement of which paths a human can write (plan + scratchpad only) vs which only the engine can write (status, current_step, tokens, last_observation).

4. **Replace `ComputeStatePatch`'s replace-whole Plan/Scratchpad with recursive per-field diffs.** Otherwise a 100-step plan edit ships 50KB instead of 200 bytes.

### Should do (production-quality)

5. **Implement Postgres LISTEN/NOTIFY in `PostgresEventStore.Stream`** (replace the 100ms poll). Add a `pg_notify` trigger on `events` insert. The API pods LISTEN once and filter by session_id in-process.

6. **Add a `useThreadState(threadId)` React hook backed by TanStack Query.** Treat it as server-authoritative with optimistic PATCH and 409-rebase. Stop pretending the SSE event log is a state model.

7. **Expose thread version on every SSE event** (custom header `thread_version:`) so clients can detect patch gaps and trigger a snapshot refetch.

8. **Add a `?mode=reconnect` SSE mode** that emits a `state.snapshot` first, then patches from the watermark. This is the only sane answer to "how does the client know what state it was in after a 2-hour disconnect."

### Nice to have

9. **Gzip SSE at the L7 proxy** instead of custom compression in Go.

10. **Switch event IDs to ULID or Snowflake** instead of the per-process counter in `AsyncEventWriter.formatEventID` (async_writer.go:117). Multiple engine replicas will collide today.

11. **Snapshot event types via `go generate` typed enum** so the SDK can't drift from the engine's event vocabulary.

### Architectural one-liner

> Replace in-process Go maps and channels with Postgres-as-bus and per-thread version vectors; treat every state patch as a first-class event in the log; switch the React SDK to TanStack Query for thread state with OCC + rebase on 409.

---

## Appendix A — Specific Code Issues Found

| Location | Issue | Severity |
|---|---|---|
| `server.go:208` `handlePatchState` | Mutates DB but does not broadcast; multi-user collab broken | 🔴 critical |
| `server.go:208` `handlePatchState` | No path-based ACL; frontend can PATCH `/last_observation` | 🔴 critical |
| `server.go:235` `handleRunThread` | `s.agent.Run(...)` is in-process; fails across service boundary | 🔴 critical |
| `server.go:279` `handleApprove` | Writes to `Server.approvals` in-memory; engine never sees reply | 🔴 critical |
| `server.go:305` `handleThreadStream` | `sess = s.sessions[lastID]` is in-process map lookup | 🔴 critical |
| `server.go:44` `Server.sessions` | In-process map; cannot survive service split | 🔴 critical |
| `state_patch.go:53` `ComputeStatePatch` | Replaces whole `Plan`/`Scratchpad` on any change | 🟠 major |
| `state_patch.go:33` `StatePatch.From/To` | Decoded but never validated against server state | 🟠 major |
| `state_patch.go:110` `applyOp` `/plan/N` | No move/reorder ops; only set/add/del/inc | 🟡 minor |
| `store_postgres.go:117` `Stream` | Polls every 100ms; comment acknowledges LISTEN/NOTIFY TODO | 🟠 major (when scaled) |
| `async_writer.go:117` `formatEventID` | Per-process monotonic counter collides across replicas | 🟠 major |
| `anvil-react-headless:333` `useChat` | O(n) re-derive on every event chunk; no event indexing | 🟡 minor |
| `anvil-react-headless:260` `useEvents` | `setEvents(prev => [...prev, e])` copies whole array | 🟡 minor |
| `anvil-client:156` `subscribe` | No abort signal; `EventSource` cannot be cancelled mid-handshake | 🟡 minor |
| `anvil-client:176` `subscribe` `onerror` | Silently swallows error; user has no way to know | 🟡 minor |
| `thread.go:82` `ThreadState` | No `Version` field; can't reason about ordering at all | 🔴 critical (precondition for everything) |
| `hitl.go:92` `ApprovalRegistry` | In-process Go map; needs Postgres table for cross-service | 🔴 critical |

## Appendix B — Suggested Schema (drop-in for production)

```sql
-- Add to existing migrations
ALTER TABLE threads ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE threads ADD COLUMN last_event_id BIGINT NOT NULL DEFAULT 0;

CREATE TABLE thread_state_events (
    id            BIGSERIAL,
    thread_id     UUID NOT NULL,
    version       BIGINT NOT NULL,
    from_version  BIGINT,
    patch         JSONB NOT NULL,
    actor_id      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, id)
);
CREATE INDEX thread_state_events_thread_id_idx ON thread_state_events(thread_id, id);

CREATE OR REPLACE FUNCTION notify_thread_state() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('anvil_thread_' || NEW.thread_id::text,
                      NEW.id::text || ':' || NEW.version::text);
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER thread_state_notify AFTER INSERT ON thread_state_events
    FOR EACH ROW EXECUTE FUNCTION notify_thread_state();

-- Approvals become durable
CREATE TABLE pending_approvals (
    thread_id     UUID NOT NULL,
    step_id       TEXT NOT NULL,
    request       JSONB NOT NULL,
    response      JSONB,
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending|responded|expired
    created_at    TIMESTAMPTZ DEFAULT now(),
    responded_at  TIMESTAMPTZ,
    PRIMARY KEY (thread_id, step_id)
);
CREATE OR REPLACE FUNCTION notify_approval() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('anvil_approval_' || NEW.thread_id::text, NEW.step_id);
    RETURN NEW;
END $$ LANGUAGE plpgsql;
```

This makes the entire control plane expressible in SQL. Every other service is replaceable.
