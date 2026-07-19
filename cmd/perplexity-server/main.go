// Perplexity clone server entry point.
//
// Usage:
//   export ANTHROPIC_API_KEY=...
//   export BRAVE_API_KEY=...    # optional, falls back to mock
//   go run ./cmd/perplexity-server
//
//   open http://localhost:8081
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/hamdisoudani/anvil/internal/core"
	"github.com/hamdisoudani/anvil/internal/perplexity"
	"github.com/hamdisoudani/anvil/internal/server"
)

// StreamingBus is a per-session pub/sub for orchestrator events.
// The orchestrator publishes events; the SSE handler subscribes.
type StreamingBus struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan Event]struct{} // sessionID -> channels
}

type Event struct {
	Type    string                 `json:"type"`    // answer.chunk, plan.step, frontend.call, done
	Payload map[string]interface{} `json:"payload"`
}

func NewStreamingBus() *StreamingBus {
	return &StreamingBus{subscribers: make(map[string]map[chan Event]struct{})}
}

func (b *StreamingBus) Subscribe(sessionID string) chan Event {
	ch := make(chan Event, 256)
	b.mu.Lock()
	if _, ok := b.subscribers[sessionID]; !ok {
		b.subscribers[sessionID] = make(map[chan Event]struct{})
	}
	b.subscribers[sessionID][ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *StreamingBus) Unsubscribe(sessionID string, ch chan Event) {
	b.mu.Lock()
	if subs, ok := b.subscribers[sessionID]; ok {
		delete(subs, ch)
	}
	b.mu.Unlock()
}

func (b *StreamingBus) Publish(sessionID string, e Event) {
	b.mu.RLock()
	subs := b.subscribers[sessionID]
	chans := make([]chan Event, 0, len(subs))
	for c := range subs {
		chans = append(chans, c)
	}
	b.mu.RUnlock()
	for _, c := range chans {
		select {
		case c <- e:
		default:
			// drop on slow subscriber
		}
	}
}

// PerplexityServer is the HTTP front-end for the Perplexity clone.
// It wraps the standard Anvil server and adds a streaming endpoint
// for orchestrator events (the agent loop emits plan steps, tool calls,
// and answer chunks, all over one SSE stream).
type PerplexityServer struct {
	*server.Server
	bus          *StreamingBus
	orchestrator *perplexity.Orchestrator
}

// Build it all
func main() {
	llm := perplexity.NewAnthropicRouter()
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		log.Fatal("ANTHROPIC_API_KEY is required. Set it and re-run.")
	}
	ws := perplexity.NewWebSearchTool()
	fp := perplexity.NewFetchPageTool()
	orch := perplexity.NewOrchestrator(llm, ws, fp)

	// Anvil core: the engine handles the session lifecycle and event ordering
	agent := core.New(
		core.WithEventStore(core.NewInMemoryEventStore()),
		core.WithCheckpointStore(core.NewInMemoryCheckpointStore()),
		core.WithCache(core.NewInMemoryCache()),
		core.WithRunRecordStore(core.NewInMemoryRunRecordStore()),
	)
	_ = agent
	_ = ws
	_ = fp

	// Threads are still needed for auth + per-user state
	threads := core.NewInMemoryThreadStore()
	auth := core.DevAuthenticator{}

	baseServer := server.NewServer(nil, nil, auth, threads)
	bus := NewStreamingBus()

	ps := &PerplexityServer{
		Server:       baseServer,
		bus:          bus,
		orchestrator: orch,
	}

	mux := http.NewServeMux()
	mux.Handle("/threads", baseServer.Handler())
	mux.Handle("/threads/", baseServer.Handler())
	mux.HandleFunc("/perplexity/ask", ps.handleAsk)
	mux.HandleFunc("/perplexity/stream/", ps.handleStream)
	mux.HandleFunc("/", ps.handleIndex)

	log.Println("🔍 Perplexity clone listening on :8081")
	log.Println("   Open http://localhost:8081 in your browser")
	log.Println("   Get a token: any string of the form dev:<user_id>")
	log.Fatal(http.ListenAndServe(":8081", mux))
}

// handleAsk starts a new search session.
// Body: {"question": "...", "thread_id": "optional"}
// Returns: {"session_id": "...", "stream_url": "..."}
func (ps *PerplexityServer) handleAsk(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Question string `json:"question"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.Question == "" {
		http.Error(w, "question required", http.StatusBadRequest)
		return
	}

	sessionID := uuid.New().String()
	go ps.runSearch(r.Context(), sessionID, req.Question)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": sessionID,
		"stream_url": "/perplexity/stream/" + sessionID,
	})
}

// runSearch runs the orchestrator and publishes events to the bus.
func (ps *PerplexityServer) runSearch(ctx context.Context, sessionID, question string) {
	result, err := ps.orchestrator.Run(ctx, question, func(eventType string, payload map[string]interface{}) {
		ps.bus.Publish(sessionID, Event{Type: eventType, Payload: payload})
	})
	if err != nil {
		ps.bus.Publish(sessionID, Event{Type: "error", Payload: map[string]interface{}{"message": err.Error()}})
		return
	}
	ps.bus.Publish(sessionID, Event{Type: "done", Payload: map[string]interface{}{
		"answer":     result.Answer,
		"sources":    result.Sources,
		"related":    result.Related,
		"session_id": sessionID,
	}})
}

// handleStream subscribes to the orchestrator's events for a session.
func (ps *PerplexityServer) handleStream(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimPrefix(r.URL.Path, "/perplexity/stream/")
	if sessionID == "" {
		http.Error(w, "session_id required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch := ps.bus.Subscribe(sessionID)
	defer ps.bus.Unsubscribe(sessionID, ch)

	// Send a ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"session_id\":\"%s\"}\n\n", sessionID)
	flusher.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(e)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Type, data)
			flusher.Flush()
			if e.Type == "done" || e.Type == "error" {
				return
			}
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// handleIndex serves a tiny embedded page for the demo.
func (ps *PerplexityServer) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, indexHTML)
}

const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Anvil Perplexity</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { --bg: #0e0e10; --panel: #18181b; --border: #27272a; --fg: #e4e4e7; --muted: #71717a; --accent: #60a5fa; --citation: #fbbf24; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
    .app { display: grid; grid-template-columns: 1fr 360px; height: 100vh; }
    .main { display: flex; flex-direction: column; padding: 24px; overflow: hidden; }
    .sidebar { background: var(--panel); border-left: 1px solid var(--border); padding: 24px; overflow-y: auto; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    h2 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; }
    .search-box { display: flex; gap: 8px; margin-bottom: 24px; }
    input { flex: 1; background: var(--panel); color: var(--fg); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; font-size: 15px; outline: none; }
    input:focus { border-color: var(--accent); }
    button { background: var(--accent); color: #0e0e10; border: none; border-radius: 12px; padding: 0 24px; font-weight: 600; cursor: pointer; }
    button:disabled { background: var(--muted); cursor: not-allowed; }
    .answer { white-space: pre-wrap; line-height: 1.6; font-size: 15px; padding: 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; flex: 1; overflow-y: auto; }
    .answer .citation { color: var(--citation); font-weight: 600; cursor: pointer; }
    .answer .citation:hover { text-decoration: underline; }
    .plan { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 13px; color: var(--muted); }
    .plan-step { display: flex; align-items: center; gap: 8px; }
    .plan-step .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
    .plan-step.running .dot { background: var(--accent); animation: pulse 1s infinite; }
    .plan-step.done .dot { background: #22c55e; }
    @keyframes pulse { 50% { opacity: 0.4; } }
    .related { margin-top: 16px; }
    .related-item { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; cursor: pointer; font-size: 14px; }
    .related-item:hover { border-color: var(--accent); }
    .source { display: flex; gap: 12px; padding: 10px; border-radius: 8px; margin-bottom: 6px; font-size: 13px; transition: background 0.2s; }
    .source.highlighted { background: rgba(96, 165, 250, 0.1); }
    .source .num { font-weight: 600; color: var(--accent); min-width: 24px; }
    .source .info { flex: 1; }
    .source .title { color: var(--fg); text-decoration: none; display: block; margin-bottom: 2px; }
    .source .domain { color: var(--muted); font-size: 11px; }
    .empty { color: var(--muted); font-style: italic; text-align: center; padding: 24px; }
    .progress { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="app">
    <div class="main">
      <h1>🔍 Anvil Perplexity</h1>
      <div class="search-box">
        <input id="q" placeholder="Ask anything…" autofocus />
        <button id="go" onclick="ask()">Search</button>
      </div>
      <div id="plan" class="plan" style="display:none"></div>
      <div id="progress" class="progress" style="display:none"></div>
      <div id="answer" class="answer">
        <div class="empty">Ask a question to start. The agent will search the web, read the top sources, and stream a cited answer.</div>
      </div>
      <div id="related" class="related"></div>
    </div>
    <div class="sidebar">
      <h2>Sources</h2>
      <div id="sources"><div class="empty">No sources yet.</div></div>
    </div>
  </div>
  <script>
    const $ = (s) => document.querySelector(s);
    const answer = $('#answer');
    const sources = $('#sources');
    const plan = $('#plan');
    const progress = $('#progress');
    const related = $('#related');
    let currentEventSource = null;
    let planSteps = {};

    function setPlan(id, intent, status, detail) {
      plan.style.display = 'block';
      if (!planSteps[id]) planSteps[id] = { intent, status: 'pending' };
      if (status) planSteps[id].status = status;
      if (detail) planSteps[id].detail = detail;
      renderPlan();
    }

    function renderPlan() {
      plan.innerHTML = Object.entries(planSteps).map(([id, s]) =>
        '<div class="plan-step ' + s.status + '"><div class="dot"></div>' + s.intent + (s.detail ? ' <span style="opacity:0.6">— ' + s.detail + '</span>' : '') + '</div>'
      ).join('');
    }

    function append(text) {
      if (answer.querySelector('.empty')) answer.innerHTML = '';
      answer.innerHTML += text;
      answer.scrollTop = answer.scrollHeight;
    }

    function setSources(list) {
      if (!list || list.length === 0) { sources.innerHTML = '<div class="empty">No sources yet.</div>'; return; }
      sources.innerHTML = list.map(s =>
        '<div class="source" data-id="' + s.id + '" data-url="' + s.url + '">' +
        '<div class="num">[' + s.id + ']</div>' +
        '<div class="info"><a class="title" href="' + s.url + '" target="_blank" rel="noopener">' + escape(s.title) + '</a>' +
        '<div class="domain">' + s.domain + '</div></div></div>'
      ).join('');
    }

    function highlight(id) {
      document.querySelectorAll('.source').forEach(el => el.classList.remove('highlighted'));
      const el = document.querySelector('.source[data-id="' + id + '"]');
      if (el) {
        el.classList.add('highlighted');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function setRelated(questions) {
      if (!questions || questions.length === 0) return;
      related.innerHTML = '<h2>Related</h2>' + questions.map(q =>
        '<div class="related-item" onclick="document.getElementById(\'q\').value = \'' + escape(q).replace(/'/g, "\\'") + '\'; ask();">' + escape(q) + '</div>'
      ).join('');
    }

    function escape(s) {
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    function ask() {
      const q = $('#q').value.trim();
      if (!q) return;
      $('#go').disabled = true;
      answer.innerHTML = '';
      related.innerHTML = '';
      planSteps = {};
      sources.innerHTML = '<div class="empty">Searching…</div>';
      progress.style.display = 'block';
      progress.textContent = 'Searching the web for: ' + q;

      if (currentEventSource) currentEventSource.close();
      const s = new EventSource('/perplexity/ask?question=' + encodeURIComponent(q));
      // Use the POST + EventSource pattern below instead
    }

    // Use POST then EventSource
    $('#go').onclick = null;
    function ask() {
      const q = $('#q').value.trim();
      if (!q) return;
      $('#go').disabled = true;
      answer.innerHTML = '';
      related.innerHTML = '';
      planSteps = {};
      sources.innerHTML = '<div class="empty">Searching…</div>';
      progress.style.display = 'block';
      progress.textContent = 'Starting search…';

      if (currentEventSource) currentEventSource.close();

      fetch('/perplexity/ask', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ question: q })
      })
      .then(r => r.json())
      .then(({ session_id, stream_url }) => {
        currentEventSource = new EventSource(stream_url);
        currentEventSource.addEventListener('ready', () => {
          progress.textContent = 'Connected. Agent is working…';
        });
        currentEventSource.addEventListener('plan.step', (e) => {
          const d = JSON.parse(e.data);
          setPlan(d.id, d.intent, d.status, d.detail);
          progress.style.display = 'none';
        });
        currentEventSource.addEventListener('answer.chunk', (e) => {
          const d = JSON.parse(e.data);
          append(d.delta);
        });
        currentEventSource.addEventListener('frontend.call', (e) => {
          const d = JSON.parse(e.data);
          if (d.name === 'render_sources') setSources(d.input.sources);
          if (d.name === 'highlight_citation') highlight(d.input.id);
          if (d.name === 'show_related') setRelated(d.input.questions);
        });
        currentEventSource.addEventListener('done', () => {
          $('#go').disabled = false;
          progress.style.display = 'none';
          currentEventSource.close();
        });
        currentEventSource.addEventListener('error', (e) => {
          progress.textContent = 'Connection error';
          $('#go').disabled = false;
        });
      });
    }

    // Enter to search
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
  </script>
</body>
</html>`
