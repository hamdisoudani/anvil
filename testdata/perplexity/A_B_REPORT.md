# A+B Report — Deploy path, SSE/HITL tests, live Perplexity × FE

**Date:** 2026-07-22  
**Target:** `https://anvil-perplexity-production.up.railway.app`

---

## A) Deploy path (Railway / embed)

### Confirmed broken before
- Dockerfile copied Vite `dist/` and filtered `anvil-chat-app` (wrong package name).
- Chat-app is **Next 16** → static export must use `out/`, package name `chat-app`.
- Live `/app/` still serves **old Vite** bundle: `index-DVdTC1LV.js` (stale embed).

### Fixed locally
| File | Change |
|---|---|
| `sdk/examples/chat-app/next.config.ts` | `output: 'export'`, `basePath`/`assetPrefix: '/app'` |
| `sdk/examples/chat-app/package.json` | `export:embed` script |
| `Dockerfile` | build `chat-app`, copy `out/` → `chat_app_dist` |
| `internal/perplexity/chat_app_dist/` | rebuilt from Next export (AgentUI shell) |
| Go binary | `go build ./cmd/perplexity-server` ✅ |

### Still needed to go live
```bash
cd /home/dinzab/anvil && railway up
# then verify:
curl -s https://anvil-perplexity-production.up.railway.app/app/ | grep -oE '_next/static/chunks/[^"]+' | head
# must NOT still show index-DVdTC1LV.js
```

---

## B) SSE + HITL HTTP tests

**File:** `internal/server/sse_hitl_test.go`  
**Result:** all PASS under `-race`

| Test | What it proves |
|---|---|
| `TestWriteSSE_Format` | `id:` / `event:` / `data:` framing |
| `TestHITL_HTTP_ApproveRejectMissing` | approve/reject/missing/forbidden/bad JSON/405 |
| `TestSSE_ThreadEvents_NoActiveSession_*` | SSE headers + keepalive path |
| `TestSSE_ThreadEvents_WithRun` | live stub run streams `think.chunk` |
| `TestSSE_Unauthorized` | 401/403 on stream |
| `TestSSE_SinceQueryAccepted` | `?since=N` no 5xx |

---

## Live Perplexity backend — works

```
POST /tasks {"question":"..."} → 200
{ session_id, stream_url: /perplexity/stream/:id, thread_id }

GET /healthz → 200 ok
GET /app/ → 200 (stale Vite UI until redeploy)
```

### Fixtures saved
- `testdata/perplexity/chat-only.sse` (41 events)
- `testdata/perplexity/search.sse` (520 events, 501 answer chunks, sources)

### Event shapes observed
`ready` → `session.start` → `plan.step`* → `frontend.call(show_plan_step)` →  
`sources.found`? → `frontend.call(render_sources)`? → `answer.chunk`* →  
`frontend.call(show_related)` → `done`

---

## FE reducer × live data — what breaks

Replayed both fixtures through `reduceAgentState` + `useChat` fold logic.

### ✅ Works
- User message from `session.start.task`
- Assistant streaming from `answer.chunk` (reference-sync OK)
- `sources.found` → 8 sources on search run
- `searchesDone=1`, `pagesRead=2` on search run
- Final `phase=done`, non-empty answer (183 / 1747 chars)
- `show_plan_step` populates `state.plan` (reason + sub_queries)

### ⚠️ Breaks / product bugs

| # | Severity | Break | Impact on components |
|---|---|---|---|
| 1 | **P1** | Prod `/app/` is **old Vite** bundle | Latest AgentUI/ChatUI/HITL never reaches users until Railway redeploy |
| 2 | **P2** | `done.payload.plan` is always `null` | Anything reading only `done` misses plan; must use `frontend.call` / `state.plan` |
| 3 | **P2** | `sources.found[].used` all `false`; `used:true` only on `done.sources` | Sources UI can’t highlight citations mid-stream |
| 4 | **P2** | Empty fetch detail `"Read: "` (no title) | AgentThinking shows blank “Reading page” row |
| 5 | **P3** | `show_related` always `questions: []` | Related-questions UI never renders |
| 6 | **P3** | `plan.step` id `"plan"` changes intent (`Planning…` → `Plan built`) | Timeline label jumps; OK if UI keys by id+status only |
| 7 | **P3** | Answer may contain `\u003c` HTML entities in URLs | Response markdown can show ugly escapes if not decoded |
| 8 | **Info** | Chat-only path never emits `sources.found` | Expected; Sources component correctly stays hidden |

### Component mapping (what to watch in browser after deploy)

| Component | Live risk |
|---|---|
| **AgentUI / ChatUI** | Works if baseUrl same-origin (`""`); after embed, API is `/tasks` on host root |
| **AgentThinking** | Empty fetch details; plan intent flip on id `plan` |
| **Sources** | Needs `!isRunning` gate; `used` flags late |
| **Reasoning / plan cards** | Must bind `state.plan` from `frontend.call`, not `done.plan` |
| **Related** | Dead until backend fills questions |
| **HITL InterruptDialog** | Not exercised by Perplexity path (no frontend tools blocked); covered by anvil-server tests |

---

## Next actions (ordered)

1. **`railway up`** with fixed Dockerfile + new `chat_app_dist`
2. Browser smoke: open `/app/`, ask search question, confirm Next shell + streaming + sources
3. Backend small fixes: page title on fetch detail, `done.plan` copy, set `used` when citing, related questions
4. Optional: pin `NEXT_PUBLIC_ANVIL_BASE_URL=""` in Docker frontend build (already default)

---

## Commands cheat sheet

```bash
# Rebuild embed + Go
cd /home/dinzab/anvil/sdk && pnpm -r build
cd examples/chat-app && pnpm build
rm -rf ../../internal/perplexity/chat_app_dist && cp -a out/. ../../internal/perplexity/chat_app_dist
cd /home/dinzab/anvil && go build -o /tmp/perplexity-server ./cmd/perplexity-server

# Tests
go test ./internal/server -race -count=1

# Live probe
curl -sS -X POST https://anvil-perplexity-production.up.railway.app/tasks \
  -H 'Content-Type: application/json' \
  -d '{"question":"ping"}'
```
