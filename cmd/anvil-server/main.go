// Anvil server entry point. A minimal HTTP server that exposes
// the agent engine over SSE, with auth, threads, and HITL.
//
// Usage:
//   go run ./cmd/anvil-server
//   # then in another terminal:
//   cd sdk/examples/chat-app && pnpm dev
//
//   curl -H "Authorization: Bearer dev:user123" \
//        -X POST http://localhost:8080/threads \
//        -d '{"title":"my first thread"}'
package main

import (
	"log"
	"net/http"

	"github.com/hamdisoudani/anvil/internal/core"
	"github.com/hamdisoudani/anvil/internal/server"
)

func main() {
	a := core.New(
		core.WithEventStore(core.NewInMemoryEventStore()),
		core.WithCheckpointStore(core.NewInMemoryCheckpointStore()),
		core.WithCache(core.NewInMemoryCache()),
		core.WithLLM(core.NewStubLLMRouter(
			"I'll search for that.",
			"Found some results.",
			"Here's what I found.",
		)),
		core.WithRunRecordStore(core.NewInMemoryRunRecordStore()),
		core.WithToolMap(core.DefaultTools()),
	)

	auth := core.DevAuthenticator{}
	threads := core.NewInMemoryThreadStore()

	s := server.NewServer(a, nil, auth, threads)
	log.Println("Anvil server listening on :8080")
	log.Println("")
	log.Println("Try:")
	log.Println(`  curl -H "Authorization: Bearer dev:user123" \`)
	log.Println(`       -X POST http://localhost:8080/threads \`)
	log.Println(`       -d '{"title":"hello"}'`)
	log.Println("")
	log.Fatal(http.ListenAndServe(":8080", s.Handler()))
}
