// Perplexity clone server entry point.
//
// Supports any OpenAI-compatible LLM (NVIDIA NIM, OpenAI, Together, Groq, etc).
//
// Bump: 2026-07-23 15:25 UTC — cache-bust trigger for Railway BuildKit
// to force re-COPY of cmd/ into /src/cmd/.
//
// Usage:
//   export OPENAI_API_KEY=***         # required
//   export OPENAI_BASE_URL=...        # optional (default: NVIDIA NIM)
//   export OPENAI_MODEL=...           # optional (default: meta/llama-3.1-70b-instruct)
//   export BRAVE_API_KEY=...          # optional, falls back to mock search
//   go run ./cmd/perplexity-server
//
//   open http://localhost:8081
//
// Docker / Vercel / Railway / Fly: see Dockerfile.perplexity and
// docker-compose.perplexity.yml in the repo root.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/hamdisoudani/anvil/internal/perplexity"
)

func main() {
	// Check for an LLM provider
	if os.Getenv("ANTHROPIC_API_KEY") == "" && os.Getenv("OPENAI_API_KEY") == "" {
		log.Println("WARNING: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set.")
		log.Println("Set one of:")
		log.Println("  export OPENAI_API_KEY=***  # for NVIDIA NIM, OpenAI, Together, etc.")
		log.Println("  export ANTHROPIC_API_KEY=***  # for Anthropic Claude")
		log.Println("The LLM step will fail without one.")
	}

	// Use the OpenAI-compatible router (works with NVIDIA NIM, OpenAI, etc.)
	// If ANTHROPIC_API_KEY is set and OPENAI_API_KEY is not, fall back to Anthropic.
	var llm perplexity.LLMRouter
	if os.Getenv("OPENAI_API_KEY") != "" {
		r := perplexity.NewOpenAICompatibleRouter()
		log.Printf("🤖 Using OpenAI-compatible: model=%s base=%s", r.Model, r.BaseURL)
		llm = r
	} else if os.Getenv("ANTHROPIC_API_KEY") != "" {
		r := perplexity.NewAnthropicRouter()
		log.Printf("🤖 Using Anthropic: model=%s", r.Model)
		llm = r
	} else {
		// Both missing — fall back to OpenAI router anyway; it'll error gracefully
		r := perplexity.NewOpenAICompatibleRouter()
		log.Printf("🤖 Using OpenAI-compatible (no key set — will fail): model=%s", r.Model)
		llm = r
	}

	// Wire up the search tool. Prefer Tavily (AI-optimized) if the key
	// is set; fall back to Brave; else the mock search.
	var ws perplexity.SearchTool
	if os.Getenv("TAVILY_API_KEY") != "" {
		ws = perplexity.NewTavilySearchTool()
		log.Printf("🔍 Using Tavily search (AI-optimized)")
	} else if os.Getenv("BRAVE_API_KEY") != "" {
		ws = perplexity.NewWebSearchTool()
		log.Printf("🔍 Using Brave search")
	} else {
		ws = perplexity.NewWebSearchTool()
		log.Printf("🔍 Using mock search (no API key)")
	}
	fp := perplexity.NewFetchPageTool()
	orch := perplexity.NewOrchestrator(llm, ws, fp)

	// NOTE: Frontend tools are NO LONGER hardcoded here.
	// They are sent by the browser with each POST /tasks request
	// (the `frontend_tools` array in the JSON body). The server
	// builds per-session FrontendTool instances from the request
	// and passes them to the orchestrator via RunOpts.FrontendTools.
	// See handler.go:handleAsk + orchestrator.go:tryFrontendTools.

	handler := perplexity.NewHandler(orch)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("🔍 Anvil Perplexity listening on :%s", port)
	log.Printf("   Open http://localhost:%s in your browser", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
