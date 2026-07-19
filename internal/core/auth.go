// Auth middleware for the HTTP server.
//
// We don't ship an auth provider — that's the platform's job.
// We ship:
//   - Authenticator interface (verify token → Identity)
//   - HTTP middleware (extract Bearer, verify, inject into context)
//   - Thread ACL enforcement (check identity vs thread owner/ACL)
//
// The default Authenticator is DevAuthenticator — accepts any token
// of the form "dev:<user_id>" and treats it as that user. Replace
// it in production with a JWT verifier, OAuth introspector, etc.

package core

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)
type ctxKey int

const (
	ctxKeyIdentity ctxKey = iota
)

// IdentityFromContext returns the verified identity attached to the
// request. Returns Anonymous if none.
func IdentityFromContext(ctx context.Context) Identity {
	if id, ok := ctx.Value(ctxKeyIdentity).(Identity); ok {
		return id
	}
	return Anonymous()
}

// WithIdentity attaches an identity to a context.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKeyIdentity, id)
}

// Authenticator verifies a token and returns the identity.
type Authenticator interface {
	Verify(ctx context.Context, token string) (Identity, error)
}

// DevAuthenticator is the default — for development and tests.
// Accepts tokens of the form "dev:<user_id>" and treats them as that
// user with a 24-hour expiry. NOT for production.
type DevAuthenticator struct{}

// Verify implements the Authenticator interface.
func (DevAuthenticator) Verify(ctx context.Context, token string) (Identity, error) {
	if !strings.HasPrefix(token, "dev:") {
		return Identity{}, errors.New("dev auth: token must start with 'dev:'")
	}
	userID := strings.TrimPrefix(token, "dev:")
	if userID == "" {
		return Identity{}, errors.New("dev auth: empty user id")
	}
	return Identity{
		UserID:    userID,
		Roles:     []string{"user"},
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}, nil
}

// BearerAuthMiddleware extracts the Bearer token, verifies it, and
// injects the identity into the request context. Unauthenticated
// requests pass through with Anonymous identity (the handler decides
// whether to reject).
func BearerAuthMiddleware(auth Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := Anonymous()
			if h := r.Header.Get("Authorization"); h != "" {
				if strings.HasPrefix(h, "Bearer ") {
					token := strings.TrimPrefix(h, "Bearer ")
					verified, err := auth.Verify(r.Context(), token)
					if err == nil && !verified.IsExpired() {
						id = verified
					}
					// If verify fails, fall through as anonymous.
					// The handler decides what to reject.
				}
			}
			ctx := WithIdentity(r.Context(), id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAuth wraps a handler to reject unauthenticated requests.
// Returns 401 if the request has no identity.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := IdentityFromContext(r.Context())
		if !id.IsAuthenticated() {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireThreadRead is a helper that fetches a thread and checks
// CanRead. Returns the thread on success, or writes 401/403/404 and
// returns nil.
func RequireThreadRead(w http.ResponseWriter, r *http.Request, store ThreadStore, threadID string) (*Thread, bool) {
	id := IdentityFromContext(r.Context())
	if !id.IsAuthenticated() {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return nil, false
	}
	t, err := store.Get(r.Context(), uuidFromString(threadID))
	if err != nil {
		http.Error(w, "thread not found", http.StatusNotFound)
		return nil, false
	}
	if !t.CanRead(id) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return nil, false
	}
	return t, true
}

// RequireThreadWrite is the write variant.
func RequireThreadWrite(w http.ResponseWriter, r *http.Request, store ThreadStore, threadID string) (*Thread, bool) {
	id := IdentityFromContext(r.Context())
	if !id.IsAuthenticated() {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return nil, false
	}
	t, err := store.Get(r.Context(), uuidFromString(threadID))
	if err != nil {
		http.Error(w, "thread not found", http.StatusNotFound)
		return nil, false
	}
	if !t.CanWrite(id) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return nil, false
	}
	return t, true
}

func uuidFromString(s string) uuid.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil
	}
	return u
}
