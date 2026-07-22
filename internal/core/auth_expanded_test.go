package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

type authFunc func(context.Context, string) (Identity, error)

func (f authFunc) Verify(ctx context.Context, token string) (Identity, error) {
	return f(ctx, token)
}

func TestIdentityContextRoundTripAndAnonymousFallback(t *testing.T) {
	if got := IdentityFromContext(context.Background()); got.UserID != "anonymous" {
		t.Fatalf("fallback user = %q", got.UserID)
	}
	want := Identity{UserID: "alice", Roles: []string{"user"}, ExpiresAt: time.Now().Add(time.Hour)}
	got := IdentityFromContext(WithIdentity(context.Background(), want))
	if got.UserID != want.UserID || !got.Can("user") {
		t.Fatalf("round trip = %+v", got)
	}
}

func TestDevAuthenticatorVerify(t *testing.T) {
	a := DevAuthenticator{}
	for _, token := range []string{"", "invalid", "dev:"} {
		if _, err := a.Verify(context.Background(), token); err == nil {
			t.Errorf("Verify(%q) expected error", token)
		}
	}
	id, err := a.Verify(context.Background(), "dev:alice")
	if err != nil || id.UserID != "alice" || !id.Can("user") || id.IsExpired() {
		t.Fatalf("valid verify: id=%+v err=%v", id, err)
	}
}

func TestBearerAuthMiddleware(t *testing.T) {
	valid := authFunc(func(context.Context, string) (Identity, error) {
		return Identity{UserID: "alice", ExpiresAt: time.Now().Add(time.Hour)}, nil
	})
	expired := authFunc(func(context.Context, string) (Identity, error) {
		return Identity{UserID: "alice", ExpiresAt: time.Now().Add(-time.Hour)}, nil
	})
	failed := authFunc(func(context.Context, string) (Identity, error) {
		return Identity{}, errors.New("bad token")
	})
	cases := []struct {
		name, header string
		auth         Authenticator
		want         string
	}{
		{"missing", "", valid, "anonymous"},
		{"wrong scheme", "Basic abc", valid, "anonymous"},
		{"valid", "Bearer abc", valid, "alice"},
		{"expired", "Bearer abc", expired, "anonymous"},
		{"verify failure", "Bearer abc", failed, "anonymous"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ""
			h := BearerAuthMiddleware(tc.auth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = IdentityFromContext(r.Context()).UserID
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", tc.header)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)
			if got != tc.want || rr.Code != http.StatusNoContent {
				t.Fatalf("got user=%q code=%d", got, rr.Code)
			}
		})
	}
}

func TestRequireAuth(t *testing.T) {
	called := false
	h := RequireAuth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))
	if rr.Code != http.StatusUnauthorized || called {
		t.Fatalf("anonymous: code=%d called=%v", rr.Code, called)
	}
	called = false
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(WithIdentity(req.Context(), Identity{UserID: "alice"}))
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || !called {
		t.Fatalf("authenticated: code=%d called=%v", rr.Code, called)
	}
}

func TestRequireThreadReadWriteBranches(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryThreadStore()
	thr := &Thread{ID: uuid.New(), OwnerID: "owner"}
	if err := store.Create(ctx, thr); err != nil {
		t.Fatal(err)
	}

	request := func(id Identity) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		return r.WithContext(WithIdentity(r.Context(), id))
	}
	checks := []struct {
		name     string
		fn       func(http.ResponseWriter, *http.Request, ThreadStore, string) (*Thread, bool)
		id       Identity
		threadID string
		code     int
		ok       bool
	}{
		{"read anonymous", RequireThreadRead, Anonymous(), thr.ID.String(), 401, false},
		{"read missing", RequireThreadRead, Identity{UserID: "owner"}, uuid.New().String(), 404, false},
		{"read forbidden", RequireThreadRead, Identity{UserID: "other"}, thr.ID.String(), 403, false},
		{"read owner", RequireThreadRead, Identity{UserID: "owner"}, thr.ID.String(), 200, true},
		{"write anonymous", RequireThreadWrite, Anonymous(), thr.ID.String(), 401, false},
		{"write missing", RequireThreadWrite, Identity{UserID: "owner"}, "bad-uuid", 404, false},
		{"write forbidden", RequireThreadWrite, Identity{UserID: "other"}, thr.ID.String(), 403, false},
		{"write owner", RequireThreadWrite, Identity{UserID: "owner"}, thr.ID.String(), 200, true},
	}
	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			got, ok := tc.fn(rr, request(tc.id), store, tc.threadID)
			if ok != tc.ok {
				t.Fatalf("ok=%v", ok)
			}
			if tc.ok && (got == nil || got.ID != thr.ID) {
				t.Fatalf("thread=%+v", got)
			}
			if rr.Code != tc.code {
				t.Fatalf("code=%d want=%d", rr.Code, tc.code)
			}
		})
	}
}

func TestUUIDFromStringAndBufferFull(t *testing.T) {
	id := uuid.New()
	if got := uuidFromString(id.String()); got != id {
		t.Fatalf("uuid=%v", got)
	}
	if got := uuidFromString("bad"); got != uuid.Nil {
		t.Fatalf("bad uuid=%v", got)
	}
	if !IsBufferFull(errBufferFull) {
		t.Error("sentinel not recognized")
	}
	if IsBufferFull(errors.New("event buffer full")) {
		t.Error("string-equivalent error incorrectly recognized")
	}
	if errBufferFull.Error() != "event buffer full" {
		t.Fatalf("message=%q", errBufferFull.Error())
	}
}
