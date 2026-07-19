# CRITIQUE A — Thread State Growth, Pagination, Auth Sharing, Live Updates, Plan Gating

**Scope:** `/home/dinzab/anvil` v0.4 — `internal/core/thread.go`, `internal/core/state_patch.go`, `internal/core/auth.go`, `internal/server/server.go` (+ a couple of cross-references to `agent.go`, `store.go`).
**Audience:** platform engineering. The output is meant to be actionable: severity + file:line + fix.

The headline is: **the core abstractions are sound (compressed state patches, owner-scoped reads, pluggable `Authenticator`)** but the production shape is wrong. State is stored in the wrong place, pagination is fake, cross-service auth is unmanaged, and there is no live-update story. The plan-tier story does not exist at all.

I'll cover the five concerns in order, then enumerate concrete gaps with severity.

---

## 1. State Bloat — Severity: HIGH (P0)

### What the code does today

`ThreadState` (thread.go:82–106) holds six top-level fields: `Plan`, `Scratchpad`, `LastObservation`, `Status`, `CurrentStep`, `TokensUsed`, `CostUSD`. The patch format in `state_patch.go` is a small RFC 6902 subset — it can ship 200 bytes for a typical edit, which is good. **But the on-disk shape is still the full object**, and the full object is loaded into memory on every `Get`.

A long-lived thread is a different beast. Plan arrays grow with each step (each `PlanStep` can have an `Args` and `Result` — the latter can be a multi-MB blob from a web fetch or a SQL query). `Scratchpad` is `map[string]interface{}` — the agent's working memory — and nothing in the code bounds it. After 200 steps of a 200k-context LLM, plan + scratchpad + observation can easily hit 5–20 MB.

The damage is layered:

1. **`ThreadStore.Get` returns the full row** every time, into Go memory (thread.go:205, server.go:201). The HTTP handler then `json.Marshal`s it for the response (server.go:205). 20 MB JSON marshal ≈ 200 ms and ~3x memory amplification.
2. **`PATCH /threads/:id/state` reads, mutates, writes the whole row** (server.go:208–233). Postgres `UPDATE … SET state = $1` rewrites the entire JSONB column. With TOAST that's a copy; for a 20 MB row it's a TOAST write + WAL entry + autovacuum churn.
3. **`GET /threads/:id/events?since=N` calls `s.events.Since(ctx, t.ID, ...)` with `limit=1000`** (server.go:326). If those 1000 events average 5 KB, you're shipping 5 MB of replays on every reconnect. SSE clients that flake will replay 5 MB repeatedly.
4. **`InMemoryThreadStore.List` returns threads whole** (thread.go:244–258). With 10K threads × 20 MB = 200 GB. The interface signature `List(ctx, ownerID, limit) ([]*Thread, error)` does not even allow the caller to ask for a projection.

### What the right model is

The codebase already has the right primitive: `EventStore` (store.go:16) is an **append-only log** keyed by session. `State` is supposed to be **derived**, not stored as a single fat document. The design notes in agent.go even call this out — checkpoints every N steps, history stays in the event log.

So the right model is **event sourcing with derived state**, exactly the way LangGraph and Mastra do it:

- **Source of truth:** events. Each `Event` is small (typ. <2 KB) and append-only.
- **Working state:** materialized view. Recomputed by folding events up to a watermark (`last_event_id`). Persist checkpoints every N steps (you already do this — `CheckpointStore`).
- **What the frontend gets:** a *projection* of the state, scoped to what it needs. Plan + scratchpad + status is the *current* projection. Full history is fetched separately (and paginated) when the user opens "show full transcript".
- **What the database stores:** a normalized `threads` row (metadata + current `state_version` + `last_event_id` + pointers to the latest checkpoint) and a separate `events` table per session.

The four-step concrete refactor:

1. **Split `ThreadState` into hot (status, current_step, tokens, cost) and cold (plan, scratchpad, last_observation).** Store hot fields as columns on `threads`. Store cold fields as a single `current_state` JSONB row that is **always rewritten from a checkpoint** — never from a streamed series of patches. Patches are applied in-memory to compute the next checkpoint.
2. **Bound `Scratchpad` and `Plan` server-side.** When `len(Plan) > 200` or `Scratchpad` has >50 keys, the engine should roll old entries into a `plan_history` blob (`jsonb` or a `events`-style row) and keep only the last N in the working state. This is the "sliding window" pattern.
3. **List/stream projections are not the full state.** Add a `ListSummaries` method on `ThreadStore` that returns `id, title, status, last_event_id, updated_at` only — the same shape that `handleThreadStatus` returns. The current `List` interface should be removed or marked deprecated.
4. **Cap the SSE replay window.** `since=N, limit=1000` is wrong. Two fixes: (a) the `limit` must be a query param, defaulted to 100, max 500; (b) if a client has more than `limit` events to catch up on, respond with `410 Gone` and force a `GET /threads/:id?since=<checkpoint_id>` for a full replay.

### Quick file:line summary

| Location | Problem | Fix |
|---|---|---|
| thread.go:82–106 | `ThreadState` is one fat struct with no size governance | Split hot/cold; add `MaxPlanSteps`, `MaxScratchpadKeys` |
| thread.go:168–174 | `ThreadStore.List` returns full threads | Add `ListSummaries(ctx, ownerID, cursor, limit) ([]ThreadSummary, nextCursor, error)` |
| server.go:208–233 | PATCH rewrites whole row | Accept the patch, buffer in memory, flush to checkpoint at cadence |
| server.go:326 | `Since(t.ID, …, 1000)` ships up to 5 MB of replays | Make `limit` a query param (default 100, max 500), return 410 on overflow |
| server.go:326 | `Since(ctx, t.ID, …)` uses **thread ID where session ID is expected** | See §6 bug list — this is a separate correctness issue |

---

## 2. Pagination — Severity: HIGH (P0)

### What's wrong

`handleThreadsCollection` (server.go:118–134) takes `?limit=N`, defaults to 50, then calls `s.threads.List(ctx, userID, limit)`. The store implementation (thread.go:244–258) then **slices the user's full thread list in memory** and returns up to `limit` of them.

Three problems:

1. **No cursor.** The list is in insertion order (`byOwner` is append-only in `Create` at thread.go:201). There is no `next_cursor`, no `prev_cursor`, no offset, no way for a client to page beyond the first window. Anything after `limit` is unreachable through the API.
2. **No sort.** Clients cannot ask for "most recent first" or "by updated_at desc" or "by status". The store is implicit-insertion-order.
3. **No filter.** No way to say `?status=running` or `?since=2026-07-01` or `?title=foo`. The UI has to fetch 50, scan client-side, and pray.
4. **Full state is shipped.** As above, the limit is applied to *full* threads. A user with 10K threads × 20 MB has no way to even enumerate the first 50 without blowing memory.

### What the industry does

- **LangGraph Server** uses cursor pagination on `(updated_at, thread_id)`, with a `MetadataFilter` query language and projection-based list responses. List endpoint returns `<=limit` summaries, not full threads.
- **Mastra** uses keyset (cursor) pagination on `updatedAt DESC, id DESC` with a stable `nextCursor` (base64 of the last row's sort key). Lists return `id, title, updatedAt, metadata` — not state.
- **CopilotKit** uses TanStack-Query-style `useThreads({ cursor, pageSize })` on the client, server returns `{ threads, nextCursor }`.
- **OpenAI Assistants** paginates with `limit` (1–100, default 20) and `order` (`asc`/`desc`) and `after`/`before` cursor.

### What Anvil should ship

```
GET /threads?limit=50&cursor=<opaque>&order=updated_desc
             &status=running&since=2026-07-01T00:00:00Z&q=<title-search>
→ 200 { "threads": [ThreadSummary, ...], "next_cursor": "..." | null }
```

Concrete store interface change (drop-in, backwards compatible with `List` for tests):

```go
type ThreadStore interface {
    // ... existing ...
    ListSummaries(ctx context.Context, q ListQuery) ([]ThreadSummary, string, error)
}

type ListQuery struct {
    OwnerID string
    Status  string    // optional
    Since   time.Time // optional
    Q       string    // optional title contains
    Order   string    // "updated_desc" (default) | "updated_asc" | "created_desc"
    Cursor  string    // opaque
    Limit   int       // default 50, max 200
}

type ThreadSummary struct {
    ID            uuid.UUID
    Title         string
    Status        string
    CurrentStep   int
    TokensUsed    int
    CostUSD       float64
    LastEventID   int64
    UpdatedAt     time.Time
}
```

Postgres implementation: `INDEX (owner_id, updated_at DESC, id DESC)` for keyset; partial index for `WHERE status = $2` if status filter is common; `ILIKE` on title for `q` is fine at this scale, but move to `pg_trgm` if thread counts get into the millions.

---

## 3. Auth State Sharing — Severity: MEDIUM-HIGH (P1)

### What you have

`Authenticator` (auth.go:45) is a clean interface. `Identity` carries `UserID`, `Roles`, `Metadata` (where plan can ride), and `ExpiresAt`. `BearerAuthMiddleware` is the only thing that injects identity into the request context. `RequireThreadRead`/`Write` (auth.go:111–146) are the ACL helpers. This is good — replaceable, testable, no coupling to a specific IdP.

### What's missing for "agent, frontend, backend in different k8s services"

Right now the model is "one bearer token per request, validated by a single `Authenticator`". That works for monolith. The moment the agent and the API server are separate pods, you have **three identity surfaces**:

1. **End-user → frontend**: the end-user's session (cookie or bearer). Frontend is the user-facing surface.
2. **Frontend → backend**: every API call from the SPA carries the user's bearer. The backend must verify it (today's `BearerAuthMiddleware` does this).
3. **Backend ↔ agent** (and any other internal service): the *backend* is now a client. It must prove to the agent service that "I am the Anvil API, and this request is on behalf of user X". You need a **service-to-service credential** that is distinct from the end-user credential, and the agent service must verify it. The end-user identity rides in the request, but the **caller** is the API, not the browser.

### What the right cross-service model looks like

Use **JWT bearer tokens with two audiences** (the pattern LangGraph Cloud, Vercel, and AWS AppSync use):

- **End-user JWT**: `iss = auth-provider`, `aud = "anvil-frontend"`, `sub = user_id`, signed by your IdP. Short-lived (15 min) + refresh. The frontend attaches this to every API call.
- **Service JWT**: `iss = "anvil-api"`, `aud = "anvil-agent"`, signed with a per-service key (EdDSA or RS256). The backend mints this with `sub = "service:anvil-api"`, `act = { sub: user_id, email }` (RFC 8693 "act" claim — "actor"). The agent verifies signature + audience + expiry, then treats `act.sub` as the user identity for ACL.
- **Optional: mTLS inside the cluster** (Istio/Linkerd do this for free) for transport-level identity. **mTLS is not a substitute for app-level auth** — it tells you "this is the anvil-api pod", not "this user is allowed to touch this thread". Use both.

### What this means for the Anvil code

Today, `IdentityFromContext` is populated **only** by `BearerAuthMiddleware` (auth.go:32). That works for frontend→backend but not for backend→agent. The right move:

1. **Add an `AuthnFilter` chain**, not a single middleware. The handler chain runs in order:
   - (1) `mTLSVerify` (if cluster provides) — establishes transport identity.
   - (2) `JWTVerify` with explicit `expected_aud` — verifies the bearer, extracts the `act` claim, builds an `Identity` that has both `Caller` (the service) and `Subject` (the user).
   - (3) Inject into context.
2. **Change `Identity`** to:
   ```go
   type Identity struct {
       Subject  string            // the end-user (== act.sub or sub)
       Caller   string            // the service making the call (== sub)
       Roles    []string
       Plan     string            // for tier gating — pulled from the IdP, not from the client
       Metadata map[string]string
       ExpiresAt time.Time
   }
   ```
   Thread ACL checks compare `Identity.Subject` to `Thread.OwnerID` (not `Identity.UserID`).
3. **Provide a `JWTAuthenticator` implementation** alongside `DevAuthenticator` — JWKS-based, audience-checked, with the `act` claim understood. Then `DevAuthenticator` and `JWTAuthenticator` are drop-in.

### Reference points

- **LangGraph Server** uses a single "auth" object passed in via headers; the SDK is a thin client. Internally, LangGraph Cloud uses signed JWTs for service-to-service and a Postgres-backed ACL.
- **Mastra** has an `auth` config block (provider, token verification, custom auth handler) and the SDK passes the token through. Service-to-service within Mastra Cloud is mTLS via the platform.
- **OpenAI Assistants API** uses a single bearer. Cross-service is your problem. They hide it because they don't expose the agent as a service.

### Quick file:line summary

| Location | Problem | Fix |
|---|---|---|
| auth.go:27–32 | `Identity` is a flat principal, no caller/subject split | Split into `Caller` (service) + `Subject` (user) per RFC 8693 |
| auth.go:45–47 | `Authenticator` is single-mode (bearer only) | Add `ServiceAuthenticator` or have `Identity` carry both |
| auth.go:74–93 | Middleware hard-codes Bearer; no `aud` check | `JWTAuthenticator` with `WithAudience("anvil-backend")` |
| thread.go:120–145 | `CanRead`/`CanWrite` use `id.UserID` | Use `id.Subject` once `Identity` is split |
| (missing) | No `JWTAuthenticator` implementation, no plan claim parsing | Add `auth_jwt.go` and `PlanFrom(Identity)` helper |

---

## 4. Stream of Threads — Severity: HIGH (P0)

### User's question

> "do you think raw http each time to get the status is the solution?"

No. Three reasons:

1. **N+1 fanout.** A UI with 50 threads visible (e.g. a "My Threads" grid) doing `GET /threads/:id/status` every 2 seconds = 25 req/s per user per tab. With 1k concurrent users, that's 25k req/s on the API just for status. Mobile clients on flaky networks amplify this.
2. **Stale data + racey merges.** Each poll returns a snapshot. If a thread transitioned through three states in the time between two polls, the UI never sees the intermediate ones. The history log has them, but the client never asks.
3. **No efficient "diff" for the list view.** Even if you cache the list, every status change forces a re-fetch of the full list (or 50 individual fetches).

### The alternatives

There are four patterns in production. The right one depends on what you mean by "stream of threads".

#### Option A: Single SSE connection for the user's list

`GET /threads/stream` opens **one SSE connection per user**. The server emits one event per thread whose `state.status` or `current_step` or `last_event_id` changed. The client subscribes once and updates the list reactively.

This is what **Linear, Height, and Notion** effectively do (they call it "live queries" or "realtime sync"). Server-side, it's a per-user pub/sub keyed on `owner_id`; an event of `thread.X.status_changed` is published to that channel. The subscriber (the API pod handling the SSE) emits it.

Cost: one connection per active user. Server holds an in-memory map `user_id → []*subscriber`. Bounded by concurrent SSE clients. Fits the existing `Sub` pattern in `core/agent.go`.

```go
// Pseudocode
GET /threads/stream  →  text/event-stream
data: {"thread_id":"...", "status":"done", "last_event_id":42, "ts":...}

data: {"thread_id":"...", "status":"running", "current_step":7, ...}
```

Plus a per-thread detail stream at `GET /threads/:id/events` (which you already have, modulo the bug in §6).

#### Option B: TanStack Query pattern with conditional requests

If SSE is too heavy, use **`If-None-Match` / `If-Modified-Since` + ETag** on `GET /threads/:id/status`. Server returns `200` with new payload, or `304 Not Modified` with empty body. Each client polls every 2s but only ships a body when something changed.

This is what **GitHub's REST API and Stripe** do for status endpoints. It cuts the payload by ~99% (just headers). The client gets the "live" feel without keeping a connection.

```http
GET /threads/:id/status
If-None-Match: "v123-456"
→ 304 Not Modified   (cheap path)
→ 200 OK   ETag: "v123-457"   { "status": ..., "step": ... }
```

Combine with `?since=last_event_id` to never miss updates:

```http
GET /threads/:id/status?since=123
→ 200 { "status":"done", "last_event_id":125, "events_behind":2 }
```

#### Option C: WebSocket subscription per thread

WebSockets are heavier than SSE for one-way updates and don't compose well with HTTP/2, but they're the right tool for **bidirectional** work (e.g. live cursor / collaborative editing of the plan). For pure status streaming, SSE is simpler.

If you go this route, do it deliberately: one WebSocket per "live editing session" on a single thread, not per user.

#### Option D: Long-poll

Don't. It's the worst of both worlds.

### What to actually ship

**Use Option A as the primary and Option B as the fallback.**

1. **Add `GET /threads/stream`** (SSE, per-user). One connection. Server emits on `state_version` change.
2. **Add ETag support to `GET /threads/:id/status`** and `GET /threads`. Server returns `ETag: "<updated_at>-<last_event_id>"`. Client uses `If-None-Match`. On 304, no work.
3. **For mobile / low-bandwidth clients**, let them poll `/threads/:id/status?since=N` and only ship the new event ID + status. That's 50 bytes.
4. **Keep `GET /threads/:id/events` (the per-thread SSE)** but fix the bug in §6 (it queries the event store with the thread ID, not the session ID) and add the replay limit.

The frontend then uses a pattern like TanStack Query: `useThreadsList()` opens the SSE on mount, updates the cache on each event, and the rest of the UI subscribes to the cache. No polling. No N+1.

---

## 5. Production Concerns — Plan Limits, Recursion Limits, Feature Gating

### The five questions, answered concretely

#### 5a. "Limitation of threads creation" — per-user/per-plan limits, where to enforce

**Where:** at the create handler **and** at the `ThreadStore`. Two-layer enforcement.

- **HTTP layer (`server.go:136–157`)**: before calling `threads.Create`, check `PlanPolicy.MaxThreadsPerUser` and `PlanPolicy.MaxConcurrentRunningThreads` against the current count. Reject with `429 Too Many Requests` and a `Retry-After` header.
- **Store layer (`thread.go: Create`)**: even on the in-memory store, enforce a hard cap (e.g. `MaxThreadsPerUser = 1000` default, `10000` for enterprise). This is your safety net against the API layer being bypassed.

```go
type PlanPolicy struct {
    MaxThreadsPerUser          int   // total threads owned
    MaxConcurrentRunning       int   // active sessions across all threads
    MaxStepsPerSession         int   // per session (already in Config.MaxSteps)
    MaxRecursionDepth          int   // sub-agent depth
    MaxTokensPerThread         int64 // cumulative token cap
    MaxCostUSDPerThread        float64
    MaxPlanStepsPerThread      int   // state bloat guard
    AllowedModels              []string // plan-gated model whitelist
}

func DefaultPolicy(plan string) PlanPolicy {
    switch plan {
    case "free":     return PlanPolicy{1, 1, 50, 2, 200_000, 1.00, 25, []string{"haiku"}}
    case "pro":      return PlanPolicy{100, 5, 200, 4, 5_000_000, 50, 200, []string{"haiku","sonnet"}}
    case "team":     return PlanPolicy{1000, 20, 500, 6, 50_000_000, 500, 1000, allModels}
    case "enterprise": return PlanPolicy{-1, -1, 2000, 8, -1, -1, -1, allModels}
    }
}
```

#### 5b. "Limitation of the agent recursing limit" — sub-agent depth cap, per-plan

**Where:** in `Agent.Run` (or whatever your orchestrator is) at the moment a sub-agent is spawned.

- `Config.MaxRecursionDepth` is the global cap. The plan cap is `PlanPolicy.MaxRecursionDepth` and is **read from the identity's plan**, not the config.
- Enforce **before** spawning: `if current_depth >= plan.MaxRecursionDepth { return ErrRecursionLimitExceeded }`.
- Bubble the error up to the SSE stream as a structured event so the frontend can render "depth limit reached — pick a simpler strategy" instead of a stack trace.

The right place to wire this is wherever the engine decides to spawn a sub-agent (a `tool_use` whose `name` is `delegate_to_agent`, or a router call). It must read `Identity` from the context and look up the plan policy.

```go
// In the orchestrator's spawn path
id := core.IdentityFromContext(ctx)
policy := planPolicyFrom(id.Plan)
if depth+1 > policy.MaxRecursionDepth {
    return fmt.Errorf("recursion depth %d exceeds plan %s limit %d", depth+1, id.Plan, policy.MaxRecursionDepth)
}
```

#### 5c. "Depends on the user plan" — how to gate features

**The plan rides on the `Identity`, not on a client-sent field.** The token is the source of truth. When the IdP issues a JWT, the user's plan is a claim (`plan: "pro"`). The `JWTAuthenticator` parses it, and the resulting `Identity.Plan` is what the rest of the system reads.

Every gate is then a one-liner against `Identity.Plan`:

```go
func (id Identity) Allows(feature Feature) bool {
    return planPolicyFrom(id.Plan).Allows(feature)
}
```

The features you want to gate from day one:

- `FeatureLongRunningSessions` (>10 min) — pro+
- `FeatureWebSearch` — pro+
- `FeatureCodeExecution` — pro+
- `FeatureParallelSubAgents` (>1) — pro+
- `FeatureCustomSystemPrompts` — pro+
- `FeatureSSO` — enterprise
- `FeatureAuditLog` — enterprise
- `FeatureTeamWorkspaces` — team+

Map each to a plan in the `PlanPolicy` struct, not in `if/else` chains scattered through handlers.

#### 5d. "This depends on the user plan" — where does plan data live, how is it checked

**Plan data lives in three places, and the contract between them is the source of truth:**

1. **IdP / billing system** (Stripe, your own DB). When a user upgrades, Stripe webhook updates your users table.
2. **`users` table in your DB** (`user_id`, `plan`, `plan_expires_at`, `subscription_id`). Read by your IdP on token mint so the JWT carries the right claim.
3. **In the JWT itself** as a `plan` claim, short-lived. This is what the `Authenticator` parses and what `Identity.Plan` reflects.

**How it's checked:** a single function. No code reads plan from anywhere else. If you find yourself writing `if req.Plan == "pro"` in a handler, that's a bug.

```go
// PlanFrom is the ONLY place that decides "what plan is this user on".
func PlanFrom(ctx context.Context) string {
    return IdentityFromContext(ctx).Plan
}

func RequireFeature(ctx context.Context, f Feature) error {
    if !IdentityFromContext(ctx).Allows(f) {
        return ErrPlanLimitExceeded
    }
    return nil
}
```

For high-stakes operations (model invocation, sub-agent spawn, file write), check **at the operation site**, not at the API edge. The API can refuse, but the operation site is the only one that can't be bypassed.

#### 5e. "How this could be built in" — concrete API design

Concretely, ship these endpoints and headers for v0.4:

```
# Thread creation enforces plan limit
POST /threads
→ 201 { "id": ..., "title": ..., ... }
→ 429 { "error": "plan_limit_exceeded", "limit": "max_threads_per_user", "current": 100, "max": 100 }
  Retry-After: 86400

# Plan is visible in status responses
GET /threads/:id/status
→ 200 { ..., "plan_limits": { "max_steps": 200, "max_recursion": 4 } }

# Sub-agent depth error
→ 400 { "error": "recursion_limit_exceeded", "depth": 4, "max": 4, "plan": "pro" }

# Plan info on the identity (debug header in dev)
X-Anvil-Plan: pro
X-Anvil-Plan-Expires: 2026-08-15T00:00:00Z

# WebSocket / SSE plan check
GET /threads/stream
→ 403 if plan doesn't allow long-running threads
```

**Database schema additions** (Postgres):

```sql
CREATE TABLE plans (
    name              text PRIMARY KEY,
    max_threads       int,
    max_concurrent    int,
    max_recursion     int,
    max_steps         int,
    max_tokens        bigint,
    max_cost_usd      numeric(10,4),
    allowed_models    text[],
    features          text[]
);

CREATE TABLE plan_changes (
    user_id     uuid,
    plan        text REFERENCES plans(name),
    changed_at  timestamptz DEFAULT now(),
    source      text  -- 'stripe_webhook' | 'admin'
);
```

Then `planPolicyFrom(string) PlanPolicy` is a `SELECT * FROM plans WHERE name = $1`. No code change to add a new tier.

---

## 6. Bug List (concrete, file:line)

| # | Severity | Location | Issue | Fix |
|---|---|---|---|---|
| 1 | **HIGH** | server.go:326 | `s.events.Since(ctx, t.ID, sinceEventID, 1000)` — passes **thread ID** as the `sessionID` parameter. The `EventStore.Since` interface (store.go:18) is keyed by session. The replay either returns 0 events silently or errors. Either way, clients never see missed events on thread reconnection. | Store events keyed by `session_id` (current model) but accept thread-level replay by unioning events across all `t.SessionIDs` in `Since`. New method: `SinceForThread(ctx, threadID, afterEventID, limit)`. Or change the schema to `thread_id` on the event table — but that's a bigger refactor. |
| 2 | **HIGH** | server.go:326 | Hard-coded `limit=1000` on the replay. A 5 MB blob on every SSE reconnect. | Make `limit` a query param, default 100, max 500. On overflow return `410 Gone` and force a full-state refetch. |
| 3 | **HIGH** | server.go:118–134 | Pagination is fake: `List` slices in memory, no cursor, no filter, no projection. | `ListSummaries(ctx, ListQuery) ([]ThreadSummary, string, error)`. |
| 4 | **HIGH** | thread.go:168–174 | `ThreadStore.List` returns full threads. No way for API to ask for summaries. | Add `ListSummaries`; deprecate `List`. |
| 5 | **HIGH** | server.go:208–233 | `PATCH /threads/:id/state` does read-modify-write of the full row. No optimistic concurrency (`From`/`To` are not checked against the current version). Two concurrent PATCHes silently overwrite each other. | Enforce the `From` version in `StatePatch` against the thread's current `state_version`. Return `409 Conflict` on mismatch. |
| 6 | **HIGH** | state_patch.go:53–108 | `ComputeStatePatch` only diffs top-level fields. Any `set /plan/N` change becomes a full `set /plan` because `planEqual` deep-compares. This defeats the patch-on-the-wire size advantage for plan edits. | Recursive diff for `/plan` and `/scratchpad` paths. Or accept the limitation and document "plan diffs are coarse" — but the file's own header claims 100KB → 200 bytes, which is currently false. |
| 7 | **HIGH** | state_patch.go:191–218 | `setPath("/plan/N", ...)` does JSON-marshal-unmarshal per op. With N=50 and OPs=20, that's 1000 round trips. | Direct slice manipulation when the value is a `PlanStep`. |
| 8 | **MEDIUM** | server.go:268 | `t.SessionIDs = append(t.SessionIDs, sess.State.SessionID)` — read-modify-write with no concurrency guard. Lost updates if two `/run` requests race. | Wrap in `ThreadStore.AppendSession(ctx, threadID, sessionID)`. |
| 9 | **MEDIUM** | auth.go:74–93 | `BearerAuthMiddleware` silently treats verify errors as anonymous. A client with a malformed token gets `401` only if a handler calls `RequireAuth`. The current `RequireThreadRead` (auth.go:111) does call it. But `/threads` (server.go:107) doesn't call `RequireAuth` — it just calls `IdentityFromContext` and checks `IsAuthenticated`. If a token is *invalid* (not just missing), the same code path runs as missing. | Distinguish "no token" → `401` from "bad token" → `401` (but log differently). The current behavior is acceptable; just document it. |
| 10 | **MEDIUM** | thread.go:120–153 | `CanRead` / `CanWrite` use `id.UserID`, but with the new `Caller`/`Subject` split, this needs to be `id.Subject`. | Use `id.Subject` for end-user checks; reserve `id.Caller` for service-to-service audit. |
| 11 | **MEDIUM** | server.go:236–277 | `/threads/:id/run` does not enforce plan limits (max concurrent sessions, max cost). A pro user can spin up 1000 sessions and burn through tokens. | Enforce `planPolicy.MaxConcurrentRunning` at run start; reject with `429` and structured error. |
| 12 | **MEDIUM** | server.go:201–205 | `GET /threads/:id` returns the full state. The list endpoint will return summaries, but the detail endpoint still fat-loads. | Add `?projection=summary` to return a `ThreadSummary` even on the detail endpoint. Default to summary, opt-in to full. |
| 13 | **MEDIUM** | server.go:236 | `s.agent.Run` is called with the request's `r.Context()`. If the client disconnects, the agent is cancelled mid-run. There's no way to "fire and continue". | Add a "detach" mode: `?detach=true` returns `202 Accepted` and the run continues under a background context. |
| 14 | **LOW** | thread.go:201 | `byOwner[ownerID] = append(byOwner[ownerID], t.ID)` — list grows unbounded per user. With 10K threads, the list-of-UUIDs is ~360 KB. Not catastrophic, but the in-memory store is for tests; the Postgres store should use a B-tree on `(owner_id, updated_at DESC)`. | Document the in-memory store as test-only. |
| 15 | **LOW** | auth.go:50–68 | `DevAuthenticator` issues 24-hour tokens. Tests shouldn't rely on real time. | Inject a clock; or document as dev-only (already done in comments — good). |

---

## 7. Recommended Rollout

If I were running this, I'd ship it in this order:

1. **v0.4.1 (one week):** Bug fixes #1, #5, #6, #8. No API change. Add `ETag` to status endpoint. Add `JWTAuthenticator` skeleton (no claim parsing yet).
2. **v0.4.2 (two weeks):** `ListSummaries`, real cursor pagination, `GET /threads/stream` SSE. This is the user-facing fix.
3. **v0.5 (one month):** `PlanPolicy` + `Identity.Plan` + claim parsing. Wire plan checks at all gates. Identity split into `Caller`/`Subject`. Backend→agent service tokens.
4. **v0.6:** State split (hot/cold), checkpoint-driven PATCH, scratchpad/plan size caps, `410 Gone` on SSE replay overflow.

The headline is: **the abstractions are right, the production shape is not.** A week of work closes the worst bugs; a month of work puts you on the right architecture. Don't try to ship the whole thing at once — the state split is the only item that touches the database schema, and it's the only one that should be coordinated with a migration.
