// HTTP server with threads, auth, and bidirectional state sync.
//
// Endpoints:
//
//   Auth (Authorization: Bearer <token>):
//   POST   /threads                     create a thread
//   GET    /threads                     list caller's threads
//   GET    /threads/:id                 get a thread
//   PATCH  /threads/:id/state           apply a state patch (frontend → server)
//   POST   /threads/:id/run             start a new run on the thread
//   POST   /threads/:id/approve         respond to a human approval gate
//   GET    /threads/:id/events?since=N  live event stream (SSE) + auth check
//   GET    /threads/:id/status          thread status
//
//   Legacy (kept for backward compat with v0.3.1):
//   POST   /tasks                       start a session
//   POST   /sessions/:id/resume         resume
//   GET    /sessions/:id/events         stream
//   POST   /sessions/:id/tool           tool result
//   GET    /sessions/:id/status         status
package server

import (
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
	agent        *core.Agent
	auth         core.Authenticator
	threads      core.ThreadStore
	events       core.EventStore
	mu           sync.RWMutex
	sessions     map[uuid.UUID]*core.Session // legacy
	approvals    *core.ApprovalRegistry      // human-in-the-loop registry
}

// NewServer creates a server around an existing agent.
// threads may be nil — in that case the auth/thread endpoints return 503.
func NewServer(agent *core.Agent, events core.EventStore, auth core.Authenticator, threads core.ThreadStore) *Server {
	return &Server{
		agent:     agent,
		auth:      auth,
		threads:   threads,
		events:    events,
		sessions:  make(map[uuid.UUID]*core.Session),
		approvals: core.NewApprovalRegistry(),
	}
}

// Handler returns the HTTP handler with all routes registered.
// All routes are wrapped in the auth middleware; the middleware
// itself never rejects, but each handler enforces the right ACL.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	// Threads
	mux.HandleFunc("/threads", s.handleThreadsCollection)
	mux.HandleFunc("/threads/", s.handleThreadsItem)
	// Legacy
	mux.HandleFunc("/tasks", s.handleTasks)
	mux.HandleFunc("/sessions/", s.handleSessions)

	return core.BearerAuthMiddleware(s.auth)(mux)
}

// ── Request/response types ────────────────────────────────────────

type createThreadReq struct {
	Title    string            `json:"title"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

type threadResp struct {
	ID        uuid.UUID         `json:"id"`
	OwnerID   string            `json:"owner_id"`
	Title     string            `json:"title"`
	State     core.ThreadState  `json:"state"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type runReq struct {
	Task          string                 `json:"task"`
	ApprovalPatch *core.StatePatch       `json:"approval_patch,omitempty"`
}

type approveReq struct {
	StepID string                 `json:"step_id"`
	Status core.ApprovalStatus    `json:"status"`
	Edited *core.PlanStep         `json:"edited,omitempty"`
	Reason string                 `json:"reason,omitempty"`
}

// ── Handlers ────────────────────────────────────────────────────

// /threads (GET = list, POST = create)
func (s *Server) handleThreadsCollection(w http.ResponseWriter, r *http.Request) {
	id := core.IdentityFromContext(r.Context())
	if !id.IsAuthenticated() {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	if s.threads == nil {
		http.Error(w, "thread store not configured", http.StatusServiceUnavailable)
		return
	}
	switch r.Method {
	case http.MethodGet:
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if v, err := strconv.Atoi(l); err == nil {
				limit = v
			}
		}
		threads, err := s.threads.List(r.Context(), id.UserID, limit)
		if err != nil {
			http.Error(w, "list: "+err.Error(), http.StatusInternalServerError)
			return
		}
		out := make([]threadResp, len(threads))
		for i, t := range threads {
			out[i] = threadToResp(t)
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		var req createThreadReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		t := &core.Thread{
			ID:       uuid.New(),
			OwnerID:  id.UserID,
			Title:    req.Title,
			Metadata: req.Metadata,
			State: core.ThreadState{
				Status:      "idle",
				Scratchpad:  map[string]interface{}{},
				Plan:        []core.PlanStep{},
			},
		}
		if err := s.threads.Create(r.Context(), t); err != nil {
			http.Error(w, "create: "+err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, threadToResp(t))

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// /threads/:id  (GET, PATCH, POST /run, POST /approve, GET /events, GET /status)
func (s *Server) handleThreadsItem(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/threads/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 1 {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	tid, err := uuid.Parse(parts[0])
	if err != nil {
		http.Error(w, "bad thread id", http.StatusBadRequest)
		return
	}
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}

	switch action {
	case "":
		s.handleGetThread(w, r, tid)
	case "state":
		s.handlePatchState(w, r, tid)
	case "run":
		s.handleRunThread(w, r, tid)
	case "approve":
		s.handleApprove(w, r, tid)
	case "events":
		s.handleThreadStream(w, r, tid)
	case "status":
		s.handleThreadStatus(w, r, tid)
	default:
		http.Error(w, "unknown action: "+action, http.StatusNotFound)
	}
}

func (s *Server) handleGetThread(w http.ResponseWriter, r *http.Request, tid uuid.UUID) {
	t, ok := core.RequireThreadRead(w, r, s.threads, tid.String())
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, threadToResp(t))
}

func (s *Server) handlePatchState(w http.ResponseWriter, r *http.Request, tid uuid.UUID) {
	if r.Method != http.MethodPatch {
		http.Error(w, "PATCH required", http.StatusMethodNotAllowed)
		return
	}
	t, ok := core.RequireThreadWrite(w, r, s.threads, tid.String())
	if !ok {
		return
	}
	var patch core.StatePatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "bad json: "+err.Error(), http.StatusBadRequest)
		return
	}
	newState, err := core.ApplyStatePatch(t.State, patch)
	if err != nil {
		http.Error(w, "patch failed: "+err.Error(), http.StatusBadRequest)
		return
	}
	t.State = newState
	if err := s.threads.Update(r.Context(), t); err != nil {
		http.Error(w, "update: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, threadToResp(t))
}

func (s *Server) handleRunThread(w http.ResponseWriter, r *http.Request, tid uuid.UUID) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	t, ok := core.RequireThreadWrite(w, r, s.threads, tid.String())
	if !ok {
		return
	}
	var req runReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	// If an approval_patch is included, apply it first.
	if req.ApprovalPatch != nil {
		newState, err := core.ApplyStatePatch(t.State, *req.ApprovalPatch)
		if err != nil {
			http.Error(w, "approval patch failed: "+err.Error(), http.StatusBadRequest)
			return
		}
		t.State = newState
		s.threads.Update(r.Context(), t)
	}
	// Start a session on the thread.
	sess, sub, err := s.agent.Run(r.Context(), req.Task)
	if err != nil {
		http.Error(w, "run: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.sessions[sess.State.SessionID] = sess
	s.mu.Unlock()
	t.SessionIDs = append(t.SessionIDs, sess.State.SessionID)
	s.threads.Update(r.Context(), t)
	_ = sub
	resp := map[string]interface{}{
		"thread_id":  tid,
		"session_id": sess.State.SessionID,
		"stream_url": fmt.Sprintf("/threads/%s/events", tid),
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request, tid uuid.UUID) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := core.RequireThreadRead(w, r, s.threads, tid.String()); !ok {
		return
	}
	var req approveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	resp := core.ApprovalResponse{
		StepID: req.StepID,
		Status: req.Status,
		Edited: req.Edited,
		Reason: req.Reason,
	}
	if err := s.approvals.Respond(tid.String(), req.StepID, resp); err != nil {
		http.Error(w, "approve: "+err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleThreadStream(w http.ResponseWriter, r *http.Request, tid uuid.UUID) {
	t, ok := core.RequireThreadRead(w, r, s.threads, tid.String())
	if !ok {
		return
	}
	// Replay missed events from the log
	var sinceEventID int64
	if s := r.URL.Query().Get("since"); s != "" {
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			sinceEventID = v
		}
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	if s.events != nil {
		missed, _ := s.events.Since(r.Context(), t.ID, sinceEventID, 1000)
		for _, e := range missed {
			if !writeSSE(w, flusher, e) {
				return
			}
		}
	}
	w.WriteHeader(http.StatusOK)
	_ = t
	// Live events: subscribe to the most recent session on this thread.
	s.mu.RLock()
	var sess *core.Session
	if len(t.SessionIDs) > 0 {
		lastID := t.SessionIDs[len(t.SessionIDs)-1]
		sess = s.sessions[lastID]
	}
	s.mu.RUnlock()
	if sess == nil {
		// No active session — send a heartbeat every 15s and keep open.
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	}
	sub := sess.Stream("http-" + uuid.NewString()[:8])
	defer sess.StopStream(sub)
	for {
		select {
		case <-r.Context().Done():
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

func (s *Server) handleThreadStatus(w http.ResponseWriter, r *http.Request, tid uuid.UUID) {
	t, ok := core.RequireThreadRead(w, r, s.threads, tid.String())
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"thread_id":   t.ID,
		"status":      t.State.Status,
		"step":        t.State.CurrentStep,
		"tokens_used": t.State.TokensUsed,
		"cost_usd":    t.State.CostUSD,
		"plan_steps":  len(t.State.Plan),
	})
}

// ── Legacy endpoints (sessions) ────────────────────────────────

func (s *Server) handleTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type req struct {
		Task string `json:"task"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	sess, sub, err := s.agent.Run(r.Context(), body.Task)
	if err != nil {
		http.Error(w, "agent: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.sessions[sess.State.SessionID] = sess
	s.mu.Unlock()
	_ = sub
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"session_id": sess.State.SessionID,
		"stream_url": fmt.Sprintf("/sessions/%s/events", sess.State.SessionID),
	})
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/sessions/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 1 {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	sid, err := uuid.Parse(parts[0])
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	switch action {
	case "events":
		s.handleLegacyStream(w, r, sid)
	case "tool":
		s.handleLegacyTool(w, r, sid)
	case "status":
		s.handleLegacyStatus(w, r, sid)
	case "resume":
		s.handleLegacyResume(w, r, sid)
	default:
		http.Error(w, "unknown: "+action, http.StatusNotFound)
	}
}

func (s *Server) handleLegacyStream(w http.ResponseWriter, r *http.Request, sid uuid.UUID) {
	s.mu.RLock()
	sess := s.sessions[sid]
	s.mu.RUnlock()
	if sess == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	flusher, _ := w.(http.Flusher)
	sub := sess.Stream("legacy-" + uuid.NewString()[:8])
	defer sess.StopStream(sub)
	for {
		select {
		case <-r.Context().Done():
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

func (s *Server) handleLegacyTool(w http.ResponseWriter, r *http.Request, sid uuid.UUID) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	s.mu.RLock()
	sess := s.sessions[sid]
	s.mu.RUnlock()
	if sess == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	type req struct {
		CallID string      `json:"call_id"`
		Result interface{} `json:"result"`
		Error  string      `json:"error"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	var toolErr error
	if body.Error != "" {
		toolErr = fmt.Errorf("%s", body.Error)
	}
	sess.DeliverToolResult(body.CallID, body.Result, toolErr)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLegacyStatus(w http.ResponseWriter, r *http.Request, sid uuid.UUID) {
	s.mu.RLock()
	sess := s.sessions[sid]
	s.mu.RUnlock()
	if sess == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	step, subCount := sess.ReadState()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"session_id": sid,
		"step":       step,
		"sub_count":  subCount,
	})
}

func (s *Server) handleLegacyResume(w http.ResponseWriter, r *http.Request, sid uuid.UUID) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	sess, sub, err := s.agent.Resume(r.Context(), sid)
	if err != nil {
		http.Error(w, "resume: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.sessions[sess.State.SessionID] = sess
	s.mu.Unlock()
	_ = sub
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"session_id": sid,
		"stream_url": fmt.Sprintf("/sessions/%s/events", sid),
	})
}

// ── helpers ────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeSSE(w http.ResponseWriter, flusher http.Flusher, e core.Event) bool {
	idStr := strconv.FormatInt(e.ID, 10)
	fmt.Fprintf(w, "id: %s\n", idStr)
	fmt.Fprintf(w, "event: %s\n", string(e.Type))
	data, _ := json.Marshal(e)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
	return true
}

func threadToResp(t *core.Thread) threadResp {
	return threadResp{
		ID:        t.ID,
		OwnerID:   t.OwnerID,
		Title:     t.Title,
		State:     t.State,
		CreatedAt: t.CreatedAt,
		UpdatedAt: t.UpdatedAt,
	}
}
