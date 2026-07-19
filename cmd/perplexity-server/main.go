// Perplexity clone server entry point.
//
// Usage:
//   export ANTHROPIC_API_KEY=...
//   export BRAVE_API_KEY=...     # optional, falls back to mock
//   go run ./cmd/perplexity-server
//
//   open http://localhost:8081
//
// Docker:
//   docker build -f Dockerfile.perplexity -t perplexity .
//   docker run -p 8081:8081 -e ANTHROPIC_API_KEY=*** perplexity
//
// Vercel/Railway/Fly:
//   See vercel.json / docker-compose.perplexity.yml / Dockerfile.perplexity
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/hamdisoudani/anvil/internal/perplexity"
)

func main() {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		log.Println("WARNING: ANTHROPIC_API_KEY not set. The LLM step will fail.")
		log.Println("Set it to enable real answers: export ANTHROPIC_API_KEY=sk-...")
	}

	// Wire up the agent
	llm := perplexity.NewAnthropicRouter()
	ws := perplexity.NewWebSearchTool()
	fp := perplexity.NewFetchPageTool()
	orch := perplexity.NewOrchestrator(llm, ws, fp)

	// The HTTP handler
	handler := perplexity.NewHandler(orch)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("🔍 Anvil Perplexity listening on :%s", port)
	log.Printf("   Open http://localhost:%s in your browser", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
