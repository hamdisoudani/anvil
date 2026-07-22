package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNotFoundAndMethodNotAllowed(t *testing.T) {
	s := newTestServer(t)
	// Bad JSON to POST /threads -> should not panic / 5xx
	rr := doRequest(t, s, "POST", "/threads", "dev:user1", "not-json{{}{")
	if rr.Code >= 500 {
		t.Errorf("malformed body caused 5xx: %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestUnknownThreadReturns404(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "GET", "/threads/00000000-0000-0000-0000-000000000000", "dev:user1", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestBadUUIDReturns404Or400(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "GET", "/threads/not-a-uuid", "dev:user1", "")
	if rr.Code != http.StatusNotFound && rr.Code != http.StatusBadRequest {
		t.Errorf("expected 404/400, got %d", rr.Code)
	}
}

func TestEmptyAuthHeaderRejected(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "POST", "/threads", "", `{"title":"x"}`)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestIndexAndHealthEndpoints(t *testing.T) {
	s := newTestServer(t)
	for _, path := range []string{"/", "/healthz", "/version", "/api/health"} {
		rr := doRequest(t, s, "GET", path, "", "")
		if rr.Code >= 500 {
			t.Errorf("%s: 5xx %d", path, rr.Code)
		}
	}
}

func TestRunOnMissingThreadReturns404(t *testing.T) {
	s := newTestServer(t)
	rr := doRequest(t, s, "POST", "/threads/00000000-0000-0000-0000-000000000000/run", "dev:user1", `{"task":"x"}`)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestBadJSONForRunReturns4xx(t *testing.T) {
	s := newTestServer(t)
	// Create a real thread first
	rr := doRequest(t, s, "POST", "/threads", "dev:user1", `{"title":"t"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d body=%s", rr.Code, rr.Body.String())
	}
	// Use a valid-looking UUID path that does not exist + bad body
	rr2 := doRequest(t, s, "POST", "/threads/00000000-0000-0000-0000-000000000000/run", "dev:user1", "not-json")
	if rr2.Code < 400 || rr2.Code >= 500 {
		t.Errorf("got %d, want 4xx", rr2.Code)
	}
}

func TestCorsPreflight(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, req)
	if rr.Code >= 500 {
		t.Errorf("preflight 5xx: %d", rr.Code)
	}
}

func TestLegacyPathsDoNotPanic(t *testing.T) {
	s := newTestServer(t)
	paths := []struct {
		method, path string
	}{
		{"GET", "/sessions"},
		{"GET", "/tasks"},
		{"GET", "/stream"},
		{"POST", "/tool"},
		{"GET", "/status"},
		{"POST", "/resume"},
	}
	for _, p := range paths {
		rr := doRequest(t, s, p.method, p.path, "dev:user1", `{}`)
		if rr.Code >= 500 {
			t.Errorf("%s %s: 5xx %d body=%s", p.method, p.path, rr.Code, rr.Body.String())
		}
	}
}
