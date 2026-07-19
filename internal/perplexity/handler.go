package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// StreamingBus is a per-session pub/sub for orchestrator events.
// In-process today; in production, this becomes Redis pub/sub for
// cross-service scaling (the v0.5 critic recommendation).
//
// Subscribers that join after a publish still receive the events
// (replay) — the bus keeps the last ReplayBufferSize events per
// session and replays them to new subscribers.
type StreamingBus struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan Event]struct{}
	history     map[string][]Event // sessionID -> recent events (replay buffer)
	histSize    int
	// Thread → sessions index, for multi-run history.
	threads map[string][]string // threadID -> [sessionID1, sessionID2, ...]
}

// ReplayBufferSize is how many events to keep per session for late joiners.
const ReplayBufferSize = 256

func NewStreamingBus() *StreamingBus {
	return &StreamingBus{
		subscribers: make(map[string]map[chan Event]struct{}),
		history:     make(map[string][]Event),
		histSize:    ReplayBufferSize,
		threads:     make(map[string][]string),
	}
}

// AddSessionToThread records that a session belongs to a thread.
// Used for "list previous runs" and "resume a conversation".
func (b *StreamingBus) AddSessionToThread(threadID, sessionID string) {
	b.mu.Lock()
	b.threads[threadID] = append(b.threads[threadID], sessionID)
	b.mu.Unlock()
}

// ThreadSessions returns the sessions in a thread, in order.
func (b *StreamingBus) ThreadSessions(threadID string) []string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := make([]string, len(b.threads[threadID]))
	copy(out, b.threads[threadID])
	return out
}

func (b *StreamingBus) Subscribe(sessionID string) chan Event {
	ch := make(chan Event, 256)
	b.mu.Lock()
	if _, ok := b.subscribers[sessionID]; !ok {
		b.subscribers[sessionID] = make(map[chan Event]struct{})
	}
	b.subscribers[sessionID][ch] = struct{}{}
	// Replay any buffered events to this subscriber
	hist := append([]Event{}, b.history[sessionID]...)
	b.mu.Unlock()

	// Replay outside the lock so we don't hold it while sending.
	go func() {
		for _, e := range hist {
			select {
			case ch <- e:
			default:
				// subscriber's buffer is full; skip this event
			}
		}
	}()
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
	// Add to history (with size cap)
	b.mu.Lock()
	if _, ok := b.history[sessionID]; !ok {
		b.history[sessionID] = make([]Event, 0, b.histSize)
	}
	hist := b.history[sessionID]
	hist = append(hist, e)
	if len(hist) > b.histSize {
		hist = hist[len(hist)-b.histSize:]
	}
	b.history[sessionID] = hist
	subs := b.subscribers[sessionID]
	chans := make([]chan Event, 0, len(subs))
	for c := range subs {
		chans = append(chans, c)
	}
	b.mu.Unlock()
	for _, c := range chans {
		select {
		case c <- e:
		default:
			// drop on slow subscriber
		}
	}
}

// Handler is the HTTP handler for the Perplexity clone.
// It exposes:
//   POST /perplexity/ask          start a search session
//   GET  /perplexity/stream/:id   live stream (SSE)
//   GET  /                       embedded HTML UI
//   GET  /healthz                health check
type Handler struct {
	Orchestrator *Orchestrator
	Bus          *StreamingBus
}

// NewHandler creates the HTTP handler.
func NewHandler(orch *Orchestrator) *Handler {
	return &Handler{Orchestrator: orch, Bus: NewStreamingBus()}
}

// ServeHTTP dispatches.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case path == "/perplexity/ask" && r.Method == "POST":
		h.handleAsk(w, r)
	case path == "/tasks" && r.Method == "POST":
		// Compatibility shim: the AnvilReact SDK calls POST /tasks.
		// Forward to the same handler.
		h.handleAsk(w, r)
	case strings.HasPrefix(path, "/perplexity/stream/"):
		h.handleStream(w, r)
	case strings.HasPrefix(path, "/sessions/") && strings.HasSuffix(path, "/events"):
		// Compatibility shim: /sessions/:id/events
		// Forward to /perplexity/stream/:id
		newPath := "/perplexity/stream/" + strings.TrimPrefix(path, "/sessions/")
		newPath = strings.TrimSuffix(newPath, "/events")
		r2 := r.Clone(r.Context())
		r2.URL.Path = newPath
		h.handleStream(w, r2)
	case path == "/healthz":
		w.WriteHeader(200)
		fmt.Fprintln(w, "ok")
	case strings.HasPrefix(path, "/app"):
		h.handleApp(w, r)
	case path == "/" || path == "/index.html":
		// Redirect to the React app
		http.Redirect(w, r, "/app/", http.StatusTemporaryRedirect)
	default:
		http.NotFound(w, r)
	}
}

// handleAsk starts a new search session. Optional thread_id continues an
// existing thread; without one, a new thread is created.
func (h *Handler) handleAsk(w http.ResponseWriter, r *http.Request) {
	var req struct {
		// New API field (preferred)
		Question string `json:"question,omitempty"`
		// Legacy field for AnvilClient.startTask compatibility
		Task    string `json:"task,omitempty"`
		ThreadID string `json:"thread_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	question := req.Question
	if question == "" {
		question = req.Task
	}
	if question == "" {
		http.Error(w, "question required", http.StatusBadRequest)
		return
	}

	threadID := req.ThreadID
	if threadID == "" {
		threadID = uuidNew() // new thread per question (browser keeps history)
	}
	sessionID := uuidNew()
	h.Bus.AddSessionToThread(threadID, sessionID)
	// Use a fresh background context — the orchestrator must outlive the
	// HTTP request that started it (otherwise a client disconnect cancels
	// the LLM call mid-stream).
	go h.runSearch(context.Background(), sessionID, threadID, req.Question)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"thread_id":  threadID,
		"session_id": sessionID,
		"stream_url": "/perplexity/stream/" + sessionID,
	})
}

// runSearch runs the orchestrator and publishes events to the bus.
func (h *Handler) runSearch(ctx context.Context, sessionID, threadID, question string) {
	// Emit a session.start event so the React SDK can render the user message
	h.Bus.Publish(sessionID, Event{
		Type: "session.start",
		Payload: map[string]interface{}{
			"task":      question,
			"thread_id": threadID,
		},
	})

	result, err := h.Orchestrator.Run(ctx, question, func(e Event) {
		h.Bus.Publish(sessionID, e)
	})
	if err != nil {
		log.Printf("session %s: error: %v", sessionID, err)
		h.Bus.Publish(sessionID, Event{Type: EventError, Payload: map[string]interface{}{"message": err.Error()}})
		return
	}
	log.Printf("session %s (thread %s): done (answer=%d chars, sources=%d, related=%d)",
		sessionID, threadID, len(result.Answer), len(result.Sources), len(result.Related))
	h.Bus.Publish(sessionID, Event{Type: EventDone, Payload: map[string]interface{}{
		"answer":     result.Answer,
		"sources":    result.Sources,
		"related":    result.Related,
		"plan":       result.Plan,
		"thread_id":  threadID,
		"session_id": sessionID,
	}})
}

// handleStream subscribes to the orchestrator's events for a session.
func (h *Handler) handleStream(w http.ResponseWriter, r *http.Request) {
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

	ch := h.Bus.Subscribe(sessionID)
	defer h.Bus.Unsubscribe(sessionID, ch)

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
			if e.Type == EventDone || e.Type == EventError {
				return
			}
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// handleIndex serves the embedded demo page.
func (h *Handler) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, indexHTML)
}
