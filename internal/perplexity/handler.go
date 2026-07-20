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
	// Buffer must be larger than ReplayBufferSize to avoid deadlock
	// when replaying synchronously (we fill the buffer before the
	// consumer starts reading).
	ch := make(chan Event, ReplayBufferSize*2)
	b.mu.Lock()
	if _, ok := b.subscribers[sessionID]; !ok {
		b.subscribers[sessionID] = make(map[chan Event]struct{})
	}
	b.subscribers[sessionID][ch] = struct{}{}
	hist := append([]Event{}, b.history[sessionID]...)
	b.mu.Unlock()

	// Replay synchronously so that replay events arrive BEFORE any
	// live Publish events (which can only happen after Subscribe
	// returns and the caller enters the event loop).
	for _, e := range hist {
		ch <- e
	}
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
type Handler struct {
	Orchestrator *Orchestrator
	Bus          *StreamingBus
}

func NewHandler(orch *Orchestrator) *Handler {
	return &Handler{Orchestrator: orch, Bus: NewStreamingBus()}
}

// ServeHTTP dispatches.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// CORS — allow any Vercel preview + custom domain. Tighten in prod.
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := r.URL.Path
	switch {
	case path == "/perplexity/ask" && r.Method == "POST":
		h.handleAsk(w, r)
	case path == "/tasks" && r.Method == "POST":
		h.handleAsk(w, r)
	case strings.HasPrefix(path, "/perplexity/stream/"):
		h.handleStream(w, r)
	case strings.HasPrefix(path, "/sessions/") && strings.HasSuffix(path, "/events"):
		// Compatibility shim: /sessions/:id/events → /perplexity/stream/:id
		// Extract the session ID FIRST, then construct the new path.
		sid := strings.TrimPrefix(path, "/sessions/")
		sid = strings.TrimSuffix(sid, "/events")
		newPath := "/perplexity/stream/" + sid
		r2 := r.Clone(r.Context())
		r2.URL.Path = newPath
		h.handleStream(w, r2)
	case path == "/healthz":
		w.WriteHeader(200)
		fmt.Fprintln(w, "ok")
	case strings.HasPrefix(path, "/app"):
		h.handleApp(w, r)
	case path == "/preview" || path == "/preview/":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(staticPreview)
		return
	case path == "/" || path == "/index.html":
		http.Redirect(w, r, "/app/", http.StatusTemporaryRedirect)
	default:
		http.NotFound(w, r)
	}
}

// handleAsk starts a new search session.
func (h *Handler) handleAsk(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Question string `json:"question,omitempty"`
		Task     string `json:"task,omitempty"`
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
		threadID = uuidNew()
	}
	sessionID := uuidNew()
	h.Bus.AddSessionToThread(threadID, sessionID)
	// FIX BUG 1: use the resolved `question` variable, not req.Question
	go h.runSearch(context.Background(), sessionID, threadID, question)

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
// Supports ?since=N parameter and Last-Event-ID header:
// both tell us which events the client already saw so we skip replay.
// After done/error the stream stays open — the client close is the
// signal to tear down. This prevents EventSource auto-reconnect
// from re-receiving the full replay buffer.
func (h *Handler) handleStream(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimPrefix(r.URL.Path, "/perplexity/stream/")
	if sessionID == "" {
		http.Error(w, "session_id required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Determine how many events to skip (events the client already saw).
	// Priority: ?since=N query param > Last-Event-ID header.
	skipCount := 0
	if sinceStr := r.URL.Query().Get("since"); sinceStr != "" {
		fmt.Sscanf(sinceStr, "%d", &skipCount)
	} else if lastID := r.Header.Get("Last-Event-ID"); lastID != "" {
		fmt.Sscanf(lastID, "%d", &skipCount)
	}

	ch := h.Bus.Subscribe(sessionID)
	defer h.Bus.Unsubscribe(sessionID, ch)

	fmt.Fprintf(w, "event: ready\ndata: {\"session_id\":\"%s\"}\n\n", sessionID)
	flusher.Flush()

	eventID := skipCount

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
			eventID++

			// Skip replayed events the client already saw
			if eventID <= skipCount {
				continue
			}

			data, _ := json.Marshal(e)
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", eventID, e.Type, data)
			flusher.Flush()

			// Do NOT close on done/error. Keep the stream open.
			// The browser's EventSource will auto-reconnect if we close,
			// causing a full replay-buffer re-send. Instead, let the
			// client disconnect naturally (tab close, navigate away).
			// The server still tears down when r.Context().Done() fires.
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// handleIndex serves the embedded demo page (unused but kept for reference).
func (h *Handler) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, indexHTML)
}
