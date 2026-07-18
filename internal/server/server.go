// Package server: a minimal HTTP+SSE server exposing Anvil sessions.
//
// Endpoints:
//   POST /tasks                  start a new session
//   POST /sessions/:id/resume    load from checkpoint, continue
//   GET  /sessions/:id/events    live stream (SSE) + resume via ?since=X
//   POST /sessions/:id/tool      frontend tool result (from a tool_call)
//   GET  /sessions/:id/status    session status, current step, drop count
//
// This is the "no protocol polish" minimal version. AG-UI, A2A, etc.
// are protocol layers on top of this same engine.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/hamdisoudani/anvil/internal/core"
)

// Server is the HTTP front-end for Anvil.
type Server struct {
	agent    *core.Agent
	mu       sync.RWMutex
	sessions map[uuid.UUID]*core.Session
	events   core.EventStore
}

// NewServer creates a server around an existing agent.
func NewServer(agent *core.Agent, events core.EventStore) *Server {
	return &Server{
		agent:    agent,
		sessions: make(map[uuid.UUID]*core.Session),
		events:   events,
	}
}

// Handler returns the HTTP handler with all routes registered.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/tasks", s.handleTasks)
	mux.HandleFunc("/sessions/", s.handleSessions)
	return mux
}

// ── Request types ────────────────────────────────────────────────────

type createTaskRequest struct {
	Task string `json:"task"`
}

type taskResponse struct {
	SessionID uuid.UUID `json:"session_id"`
	StreamURL string    `json:"stream_url"`
}

type toolResultRequest struct {
	CallID string      `json:"call_id"`
	Result interface{} `json:"result"`
	Error  string      `json:"error,omitempty"`
}

// ── Handlers ────────────────────────────────────────────────────────

// POST /tasks
func (s *Server) handleTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req createTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Task == "" {
		http.Error(w, "task required", http.StatusBadRequest)
		return
	}

	sess, sub, err := s.agent.Run(r.Context(), req.Task)
	if err != nil {
		http.Error(w, "agent error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.sessions[sess.State.SessionID] = sess
	s.mu.Unlock()

	resp := taskResponse{
		SessionID: sess.State.SessionID,
		StreamURL: fmt.Sprintf("/sessions/%s/events", sess.State.SessionID),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = sub // keep it referenced; the loop emits to it
	_ = json.NewEncoder(w).Encode(resp)
}

// /sessions/:id/...
func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	// Parse: /sessions/<uuid>/<action>
	path := strings.TrimPrefix(r.URL.Path, "/sessions/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 1 {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	sessionID, err := uuid.Parse(parts[0])
	if err != nil {
		http.Error(w, "invalid session id", http.StatusBadRequest)
		return
	}
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}

	switch action {
	case "":
		http.Error(w, "no action", http.StatusBadRequest)
	case "events":
		s.handleStream(w, r, sessionID)
	case "resume":
		s.handleResume(w, r, sessionID)
	case "tool":
		s.handleToolResult(w, r, sessionID)
	case "status":
		s.handleStatus(w, r, sessionID)
	default:
		http.Error(w, "unknown action: "+action, http.StatusNotFound)
	}
}

// GET /sessions/:id/events?since=N
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, sessionID uuid.UUID) {
	// Parse since
	var sinceEventID int64
	if s := r.URL.Query().Get("since"); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			sinceEventID = v
		}
	}

	// SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Replay missed events from the log
	if sinceEventID > 0 && s.events != nil {
		missed, err := s.events.Since(r.Context(), sessionID, sinceEventID, 1000)
		if err == nil {
			for _, e := range missed {
				if !writeSSE(w, flusher, e) {
					return // client gone
				}
			}
		}
	}

	// Subscribe to live events
	s.mu.RLock()
	sess, exists := s.sessions[sessionID]
	s.mu.RUnlock()
	if !exists {
		// Not in memory — try to load from checkpoint + replay full log
		// For now, just say session not found
		http.Error(w, "session not found in memory", http.StatusNotFound)
		return
	}

	sub := sess.Stream("http-" + uuid.NewString()[:8])
	defer sess.StopStream(sub)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-sub.Channel():
			if !ok {
				return
			}
			if !writeSSE(w, flusher, e) {
				return
			}
		}
	}
}

// POST /sessions/:id/resume
func (s *Server) handleResume(w http.ResponseWriter, r *http.Request, sessionID uuid.UUID) {
	sess, sub, err := s.agent.Resume(r.Context(), sessionID)
	if err != nil {
		http.Error(w, "resume error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.sessions[sessionID] = sess
	s.mu.Unlock()
	_ = sub

	resp := taskResponse{
		SessionID: sessionID,
		StreamURL: fmt.Sprintf("/sessions/%s/events", sessionID),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// POST /sessions/:id/tool — frontend sends tool result back
func (s *Server) handleToolResult(w http.ResponseWriter, r *http.Request, sessionID uuid.UUID) {
	var req toolResultRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.CallID == "" {
		http.Error(w, "call_id required", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	sess := s.sessions[sessionID]
	s.mu.RUnlock()
	if sess == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var err error
	if req.Error != "" {
		err = fmt.Errorf("%s", req.Error)
	}
	sess.DeliverToolResult(req.CallID, req.Result, err)

	w.WriteHeader(http.StatusNoContent)
}

// GET /sessions/:id/status
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request, sessionID uuid.UUID) {
	s.mu.RLock()
	sess := s.sessions[sessionID]
	s.mu.RUnlock()
	if sess == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	resp := map[string]interface{}{
		"session_id": sessionID,
		"step":       sess.State.Step,
		"sub_count":  len(sess.State.History),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// writeSSE writes one event in SSE format. Returns false if client gone.
func writeSSE(w http.ResponseWriter, flusher http.Flusher, e core.Event) bool {
	// Each event has: id, event, data lines
	idStr := strconv.FormatInt(e.ID, 10)
	fmt.Fprintf(w, "id: %s\n", idStr)
	fmt.Fprintf(w, "event: %s\n", string(e.Type))
	data, _ := json.Marshal(e)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
	return true
}

// keep imports used
var _ = time.Second
var _ = context.Background
