package perplexity

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
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
// Sized large enough to hold a full agent run (plan + dozens of search
// results + 100+ answer chunks + done). If a run exceeds this, the
// oldest answer chunks are dropped — but session.start is protected
// (see Publish) so the user message is always recoverable on reload.
const ReplayBufferSize = 4096

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
	// Add to history (with size cap). SESSION-LIFETIME events
	// (e.g. session.start) are protected from eviction so the
	// user message is always recoverable on reload.
	b.mu.Lock()
	if _, ok := b.history[sessionID]; !ok {
		b.history[sessionID] = make([]Event, 0, b.histSize)
	}
	hist := b.history[sessionID]
	if e.Type == EventSessionStart {
		// Pin session.start at index 0 — never evict.
		// Drop any other "pin" event we may have inserted (defensive).
		filtered := hist[:0]
		for _, h := range hist {
			if h.Type != EventSessionStart {
				filtered = append(filtered, h)
			}
		}
		hist = append([]Event{e}, filtered...)
	} else {
		hist = append(hist, e)
	}
	if len(hist) > b.histSize {
		// Drop oldest non-pinned events only.
		excess := len(hist) - b.histSize
		drop := 0
		i := 0
		for drop < excess && i < len(hist) {
			if hist[i].Type != EventSessionStart {
				hist = append(hist[:i], hist[i+1:]...)
				drop++
			} else {
				i++
			}
		}
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

	// Session cancel map: sessionID -> cancel func for in-flight runs.
	cancelMu sync.Mutex
	cancels  map[string]context.CancelFunc

	// Thread message memory (server-side multi-turn).
	threadMu   sync.RWMutex
	threadMsgs map[string][]Message // threadID -> conversation turns

	// Rate limiting (token bucket per IP, simple).
	rateMu   sync.Mutex
	rateHits map[string][]time.Time

	// CORS allowlist; empty = reflect request Origin (dev). Set ANVIL_CORS_ORIGINS.
	allowedOrigins map[string]struct{}
}

func NewHandler(orch *Orchestrator) *Handler {
	h := &Handler{
		Orchestrator:   orch,
		Bus:            NewStreamingBus(),
		cancels:        make(map[string]context.CancelFunc),
		threadMsgs:     make(map[string][]Message),
		rateHits:       make(map[string][]time.Time),
		allowedOrigins: parseAllowedOrigins(os.Getenv("ANVIL_CORS_ORIGINS")),
	}
	return h
}

func parseAllowedOrigins(raw string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			out[o] = struct{}{}
		}
	}
	return out
}

// ServeHTTP dispatches.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.applyCORS(w, r)
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
		sid := strings.TrimPrefix(path, "/sessions/")
		sid = strings.TrimSuffix(sid, "/events")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/perplexity/stream/" + sid
		h.handleStream(w, r2)
	case strings.HasPrefix(path, "/sessions/") && strings.HasSuffix(path, "/cancel") && r.Method == "POST":
		sid := strings.TrimPrefix(path, "/sessions/")
		sid = strings.TrimSuffix(sid, "/cancel")
		h.handleCancel(w, r, sid)
	case strings.HasPrefix(path, "/perplexity/cancel/") && r.Method == "POST":
		sid := strings.TrimPrefix(path, "/perplexity/cancel/")
		h.handleCancel(w, r, sid)
	case strings.HasPrefix(path, "/perplexity/thread/") && r.Method == "GET":
		tid := strings.TrimPrefix(path, "/perplexity/thread/")
		h.handleThread(w, r, tid)
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

func (h *Handler) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	allow := ""
	if len(h.allowedOrigins) == 0 {
		// Dev default: reflect origin (local + preview deploys).
		allow = origin
	} else if _, ok := h.allowedOrigins[origin]; ok {
		allow = origin
	} else if _, ok := h.allowedOrigins["*"]; ok {
		allow = "*"
	}
	if allow == "" {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", allow)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
	if allow != "*" {
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	w.Header().Set("Vary", "Origin")
}

// rateLimit: max 30 asks / minute / IP.
func (h *Handler) rateLimit(ip string) bool {
	const maxHits = 30
	const window = time.Minute
	now := time.Now()
	h.rateMu.Lock()
	defer h.rateMu.Unlock()
	hits := h.rateHits[ip]
	// drop old
	kept := hits[:0]
	for _, t := range hits {
		if now.Sub(t) < window {
			kept = append(kept, t)
		}
	}
	if len(kept) >= maxHits {
		h.rateHits[ip] = kept
		return false
	}
	h.rateHits[ip] = append(kept, now)
	return true
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// handleAsk starts a new search session (optionally continuing a thread).
func (h *Handler) handleAsk(w http.ResponseWriter, r *http.Request) {
	if !h.rateLimit(clientIP(r)) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	var req struct {
		Question string `json:"question,omitempty"`
		Task     string `json:"task,omitempty"`
		ThreadID string `json:"thread_id,omitempty"`
		Focus    string `json:"focus,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
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

	// Cancellable context for Stop button / cancel endpoint.
	ctx, cancel := context.WithCancel(context.Background())
	h.cancelMu.Lock()
	h.cancels[sessionID] = cancel
	h.cancelMu.Unlock()

	history := h.threadHistory(threadID)
	go h.runSearch(ctx, sessionID, threadID, question, req.Focus, history)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"thread_id":  threadID,
		"session_id": sessionID,
		"stream_url": "/perplexity/stream/" + sessionID,
	})
}

func (h *Handler) handleCancel(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		http.Error(w, "session_id required", http.StatusBadRequest)
		return
	}
	h.cancelMu.Lock()
	cancel, ok := h.cancels[sessionID]
	if ok {
		delete(h.cancels, sessionID)
	}
	h.cancelMu.Unlock()
	if ok && cancel != nil {
		cancel()
		h.Bus.Publish(sessionID, Event{
			Type:    EventError,
			Payload: map[string]interface{}{"message": "cancelled by user", "code": "cancelled", "severity": "info", "recoverable": true, "retryable": true},
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "cancelled": ok})
}

func (h *Handler) handleThread(w http.ResponseWriter, r *http.Request, threadID string) {
	if threadID == "" {
		http.Error(w, "thread_id required", http.StatusBadRequest)
		return
	}
	sessions := h.Bus.ThreadSessions(threadID)
	msgs := h.threadHistory(threadID)
	// Build lightweight message DTOs for the client
	outMsgs := make([]map[string]string, 0, len(msgs))
	for _, m := range msgs {
		outMsgs = append(outMsgs, map[string]string{"role": m.Role, "content": m.Content})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"thread_id":   threadID,
		"session_ids": sessions,
		"messages":    outMsgs,
	})
}

func (h *Handler) threadHistory(threadID string) []Message {
	h.threadMu.RLock()
	defer h.threadMu.RUnlock()
	src := h.threadMsgs[threadID]
	out := make([]Message, len(src))
	copy(out, src)
	return out
}

func (h *Handler) appendThreadTurn(threadID, question, answer string) {
	h.threadMu.Lock()
	defer h.threadMu.Unlock()
	h.threadMsgs[threadID] = append(h.threadMsgs[threadID],
		Message{Role: "user", Content: question},
		Message{Role: "assistant", Content: answer},
	)
	// Cap thread memory
	const maxTurns = 40 // 20 pairs
	if len(h.threadMsgs[threadID]) > maxTurns {
		h.threadMsgs[threadID] = h.threadMsgs[threadID][len(h.threadMsgs[threadID])-maxTurns:]
	}
}

// runSearch runs the orchestrator and publishes events to the bus.
func (h *Handler) runSearch(ctx context.Context, sessionID, threadID, question, focus string, history []Message) {
	defer func() {
		h.cancelMu.Lock()
		delete(h.cancels, sessionID)
		h.cancelMu.Unlock()
	}()

	// Emit a session.start event so the React SDK can render the user message
	h.Bus.Publish(sessionID, Event{
		Type: "session.start",
		Payload: map[string]interface{}{
			"task":      question,
			"thread_id": threadID,
			"focus":     focus,
		},
	})

	result, err := h.Orchestrator.Run(ctx, question, func(e Event) {
		h.Bus.Publish(sessionID, e)
	}, RunOpts{History: history, Focus: focus})
	if err != nil {
		if ctx.Err() != nil {
			log.Printf("session %s: cancelled", sessionID)
			h.Bus.Publish(sessionID, Event{Type: EventError, Payload: map[string]interface{}{
				"message": "cancelled", "code": "cancelled", "severity": "info", "retryable": true, "recoverable": true,
			}})
			return
		}
		log.Printf("session %s: error: %v", sessionID, err)
		h.Bus.Publish(sessionID, Event{Type: EventError, Payload: map[string]interface{}{"message": err.Error()}})
		return
	}
	// Persist multi-turn memory
	h.appendThreadTurn(threadID, question, result.Answer)

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
// Supports ?since=N parameter and Last-Event-ID header.
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

	eventID := 0

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
			if eventID <= skipCount {
				continue
			}
			data, _ := json.Marshal(e)
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", eventID, e.Type, data)
			flusher.Flush()
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
