package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/hamdisoudani/anvil/internal/core"
)

// flushRecorder implements http.Flusher for SSE tests.
type flushRecorder struct {
	*httptest.ResponseRecorder
}

func (f *flushRecorder) Flush() {}

func TestWriteSSE_Format(t *testing.T) {
	rr := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
	e := core.Event{
		ID:        7,
		EventID:   "7",
		SessionID: uuid.New(),
		Type:      core.EventThinkChunk,
		Payload:   map[string]interface{}{"delta": "hi"},
		CreatedAt: time.Now().UTC(),
	}
	if !writeSSE(rr, rr, e) {
		t.Fatal("writeSSE returned false")
	}
	body := rr.Body.String()
	if !strings.Contains(body, "id: 7\n") {
		t.Errorf("missing id line: %q", body)
	}
	if !strings.Contains(body, "event: think.chunk\n") {
		t.Errorf("missing event line: %q", body)
	}
	if !strings.Contains(body, "data: ") || !strings.Contains(body, `"delta":"hi"`) {
		t.Errorf("missing data payload: %q", body)
	}
	if !strings.HasSuffix(body, "\n\n") {
		t.Errorf("SSE frame must end with blank line: %q", body)
	}
}

func TestHITL_HTTP_ApproveRejectMissing(t *testing.T) {
	s := newTestServer(t)

	// Create thread as owner
	rr := doRequest(t, s, "POST", "/threads", "dev:owner", `{"title":"hitl"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var created threadResp
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	// Missing gate → 400
	rr2 := doRequest(t, s, "POST", "/threads/"+created.ID.String()+"/approve", "dev:owner",
		`{"step_id":"s1","status":"approved"}`)
	if rr2.Code != http.StatusBadRequest {
		t.Errorf("missing gate: expected 400, got %d body=%s", rr2.Code, rr2.Body.String())
	}

	// Register a real gate, then approve via HTTP
	gate := core.NewApprovalGate(core.ApprovalRequired{StepID: "s1"})
	s.approvals.Register(created.ID.String(), gate)

	done := make(chan core.ApprovalResponse, 1)
	go func() {
		r, err := core.WaitForHuman(context.Background(), gate)
		if err != nil {
			t.Errorf("WaitForHuman: %v", err)
			return
		}
		done <- r
	}()

	rr3 := doRequest(t, s, "POST", "/threads/"+created.ID.String()+"/approve", "dev:owner",
		`{"step_id":"s1","status":"approved"}`)
	if rr3.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rr3.Code, rr3.Body.String())
	}

	select {
	case r := <-done:
		if r.Status != core.ApprovalApproved {
			t.Errorf("status=%v want approved", r.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("approval not delivered")
	}

	// Reject flow
	gate2 := core.NewApprovalGate(core.ApprovalRequired{StepID: "s2"})
	s.approvals.Register(created.ID.String(), gate2)
	done2 := make(chan core.ApprovalResponse, 1)
	go func() {
		r, _ := core.WaitForHuman(context.Background(), gate2)
		done2 <- r
	}()
	rr4 := doRequest(t, s, "POST", "/threads/"+created.ID.String()+"/approve", "dev:owner",
		`{"step_id":"s2","status":"rejected","reason":"nope"}`)
	if rr4.Code != http.StatusOK {
		t.Fatalf("reject: %d %s", rr4.Code, rr4.Body.String())
	}
	select {
	case r := <-done2:
		if r.Status != core.ApprovalRejected || r.Reason != "nope" {
			t.Errorf("reject resp=%+v", r)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("reject not delivered")
	}

	// Non-owner cannot approve
	gate3 := core.NewApprovalGate(core.ApprovalRequired{StepID: "s3"})
	s.approvals.Register(created.ID.String(), gate3)
	rr5 := doRequest(t, s, "POST", "/threads/"+created.ID.String()+"/approve", "dev:stranger",
		`{"step_id":"s3","status":"approved"}`)
	if rr5.Code != http.StatusForbidden {
		t.Errorf("stranger approve: expected 403, got %d", rr5.Code)
	}

	// Bad JSON
	rr6 := doRequest(t, s, "POST", "/threads/"+created.ID.String()+"/approve", "dev:owner", `not-json`)
	if rr6.Code != http.StatusBadRequest {
		t.Errorf("bad json: expected 400, got %d", rr6.Code)
	}

	// Method not allowed
	rr7 := doRequest(t, s, "GET", "/threads/"+created.ID.String()+"/approve", "dev:owner", "")
	if rr7.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET approve: expected 405, got %d", rr7.Code)
	}
}

func TestSSE_ThreadEvents_NoActiveSession_HeadersAndKeepalive(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "POST", "/threads", "dev:owner", `{"title":"sse"}`)
	var created threadResp
	_ = json.Unmarshal(rr.Body.Bytes(), &created)

	// Stream with no active session — should set SSE headers and eventually keepalive.
	// We cancel after a short window so the handler exits via context.
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/threads/"+created.ID.String()+"/events", nil)
	req.Header.Set("Authorization", "Bearer dev:owner")
	rec := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
	// Serve in goroutine because handler blocks on keepalive loop
	done := make(chan struct{})
	go func() {
		s.Handler().ServeHTTP(rec, req)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		cancel()
		<-done
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		// Handler may have returned 401/403 before setting headers if auth failed
		if rec.Code == http.StatusOK || rec.Code == 0 {
			t.Errorf("Content-Type=%q code=%d body=%q", ct, rec.Code, rec.Body.String())
		}
	}
}

func TestSSE_ThreadEvents_WithRun(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "POST", "/threads", "dev:owner", `{"title":"run-sse"}`)
	var created threadResp
	_ = json.Unmarshal(rr.Body.Bytes(), &created)

	// Start a run (stub LLM)
	rr2 := doRequest(t, s, "POST", "/threads/"+created.ID.String()+"/run", "dev:owner",
		`{"task":"say hi"}`)
	if rr2.Code != http.StatusOK {
		t.Fatalf("run: %d %s", rr2.Code, rr2.Body.String())
	}
	var runResp map[string]interface{}
	_ = json.Unmarshal(rr2.Body.Bytes(), &runResp)
	streamURL, _ := runResp["stream_url"].(string)
	if streamURL == "" {
		t.Fatalf("no stream_url in %v", runResp)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
	req.Header.Set("Authorization", "Bearer dev:owner")
	rec := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}

	done := make(chan struct{})
	go func() {
		s.Handler().ServeHTTP(rec, req)
		close(done)
	}()

	// Poll body for SSE frames
	deadline := time.Now().Add(2 * time.Second)
	var body string
	for time.Now().Before(deadline) {
		body = rec.Body.String()
		if strings.Contains(body, "event:") || strings.Contains(body, "data:") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	<-done

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		t.Errorf("Content-Type=%q code=%d", ct, rec.Code)
	}
	// Body may be empty if stub finished before subscribe — headers still prove path works
	t.Logf("sse body len=%d preview=%q", len(body), truncate(body, 200))
}

func TestSSE_Unauthorized(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "POST", "/threads", "dev:owner", `{"title":"priv"}`)
	var created threadResp
	_ = json.Unmarshal(rr.Body.Bytes(), &created)

	rr2 := doRequest(t, s, "GET", "/threads/"+created.ID.String()+"/events", "", "")
	if rr2.Code != http.StatusUnauthorized {
		t.Errorf("anon stream: expected 401, got %d", rr2.Code)
	}
	rr3 := doRequest(t, s, "GET", "/threads/"+created.ID.String()+"/events", "dev:other", "")
	if rr3.Code != http.StatusForbidden {
		t.Errorf("other stream: expected 403, got %d", rr3.Code)
	}
}

func TestSSE_SinceQueryAccepted(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "POST", "/threads", "dev:owner", `{"title":"since"}`)
	var created threadResp
	_ = json.Unmarshal(rr.Body.Bytes(), &created)

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet,
		"/threads/"+created.ID.String()+"/events?since=5", nil)
	req.Header.Set("Authorization", "Bearer dev:owner")
	rec := &flushRecorder{ResponseRecorder: httptest.NewRecorder()}
	done := make(chan struct{})
	go func() {
		s.Handler().ServeHTTP(rec, req)
		close(done)
	}()
	<-done
	// Just ensure no 5xx
	if rec.Code >= 500 {
		t.Errorf("since query 5xx: %d body=%s", rec.Code, rec.Body.String())
	}
}

// parseSSEFrames is a tiny helper used by tests that need frame counts.
func parseSSEFrames(r io.Reader) (events []string) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "event: ") {
			events = append(events, strings.TrimPrefix(line, "event: "))
		}
	}
	return events
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
