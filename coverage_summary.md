# Go SDK Test Suite — Final Report

**Project:** `github.com/hamdisoudani/anvil` (Go 1.25)
**Date:** 2026-07-22
**Status:** ✅ ALL PASS (race-clean, vet-clean)

## Results

| Check | Status |
|---|---|
| `go vet ./...` | ✅ PASS |
| `go test ./... -race` | ✅ PASS (no races) |
| Failures | **0** |
| Tests run | **130** (`=== RUN`) / **117** pass markers (rest are subtests/helpers) |

## Coverage by package

| Package | Coverage | Delta vs start |
|---|---|---|
| `internal/core` | **53.4%** | +18.1 pp (was 35.3%) |
| `internal/plugin` | **86.1%** | +24.4 pp (was 61.7%) |
| `internal/server` | **29.2%** | +2.6 pp (was 26.6%) |
| `internal/perplexity` | **22.7%** | +9.3 pp (was 13.4%) |
| **Overall** | **40.5%** | +13.2 pp (was 27.3%) |

## New test files added

- `internal/core/expanded_test.go` — checkpoint/thread ACL/HITL/interrupt/cache/event store/async writer/run records
- `internal/core/auth_expanded_test.go` — Identity context, DevAuthenticator, Bearer middleware, RequireAuth/Thread ACL helpers, buffer-full sentinel
- `internal/plugin/options_recovery_test.go` — AlwaysCheckpoint, recovery policies, option constructors (WithLLM/AGUI/Crew/GroupChat/HITL/CodeExec/Speculation)
- `internal/perplexity/expanded_test.go` — FetchPageTool, Tavily tool shape, extractText, parseAllowedOrigins, safeStr, applyFocus
- `internal/server/expanded_test.go` — malformed JSON, missing thread 404, bad UUID, empty auth, health paths, legacy endpoints, CORS preflight

## Artefacts

- `coverage.out` — race-enabled atomic profile
- `coverage.html` — HTML report (open in browser)
- `coverage_summary.md` — this file

## Notes

- `cmd/*` packages have no tests (main binaries only). `go: no such tool "covdata"` is a Go 1.25 tooling warning on main packages under `-race -cover`, not a failure.
- Production code was **not** modified — tests only.
- Remaining low-coverage areas are mostly live-network LLM/search paths (Anthropic/OpenAI/Tavily Stream/Execute) and SSE/legacy handler branches that need heavier HTTP harnesses.
