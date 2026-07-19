// Anvil server entry point. A minimal HTTP server that exposes
// the agent engine over SSE. This is what the example app talks to.
//
// Usage:
//   go run ./cmd/anvil-server
//   # then in another terminal:
//   cd sdk/examples/chat-app && pnpm dev
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

	s := server.NewServer(a, nil)
	log.Println("Anvil server listening on :8080")
	log.Println("Try: curl -X POST http://localhost:8080/tasks -d '{\"task\":\"hello\"}' -H 'Content-Type: application/json'")
	log.Fatal(http.ListenAndServe(":8080", s.Handler()))
}
