// Package core — Thread model + ownership + auth
//
// A Thread is a logical unit of work owned by a user. A thread contains
// one or more Sessions (agent runs). Threads have a persisted state
// (compressed plan, scratchpad, history summary) that the frontend
// can subscribe to and edit.
//
// The engine itself is not authenticated — that's the platform's
// job (API gateway, OAuth provider, etc.). We ship the primitives
// (Owner field, ACL check, auth middleware) so the platform can
// plug in any identity system.

package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Identity is a verified principal (user, service account, agent, etc).
// Comes from the auth middleware after token verification.
type Identity struct {
	UserID    string            // who is this
	Roles     []string          // what can they do
	Metadata  map[string]string // any extra context (org, team, plan, etc)
	ExpiresAt time.Time
}

// IsExpired returns true if the identity is no longer valid.
func (id Identity) IsExpired() bool {
	return time.Now().After(id.ExpiresAt)
}

// Can returns true if the identity has the given role.
func (id Identity) Can(role string) bool {
	for _, r := range id.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// Anonymous returns a system identity (for unauthenticated requests
// that the platform has explicitly allowed, e.g. health checks).
func Anonymous() Identity {
	return Identity{UserID: "anonymous"}
}

// IsAuthenticated returns true if this is a real user (not anon).
func (id Identity) IsAuthenticated() bool {
	return id.UserID != "" && id.UserID != "anonymous"
}

// Thread is the persistent unit of work.
//
// One thread = one user-facing conversation / task. A thread can
// have multiple agent runs (sessions) over its lifetime — for example,
// "research this topic" can spawn 3 sessions over 3 days, all in
// the same thread.
type Thread struct {
	ID         uuid.UUID              `json:"id"`
	OwnerID    string                 `json:"owner_id"`
	Title      string                 `json:"title"`
	CreatedAt  time.Time              `json:"created_at"`
	UpdatedAt  time.Time              `json:"updated_at"`
	State      ThreadState            `json:"state"`
	SessionIDs []uuid.UUID            `json:"session_ids,omitempty"`
	ACL        ThreadACL              `json:"acl"`
	Metadata   map[string]string      `json:"metadata,omitempty"`
	mu         sync.RWMutex
}

// ThreadState is the compressed state visible to the frontend.
// It's a slim representation — the full history and tool calls
// stay in the event log. The frontend only sees the working state.
type ThreadState struct {
	// Plan is the current plan (what the agent intends to do).
	// Editable from the frontend.
	Plan []PlanStep `json:"plan"`

	// Scratchpad is the agent's working memory.
	// Editable from the frontend (advanced users can inject hints).
	Scratchpad map[string]interface{} `json:"scratchpad"`

	// LastObservation is the most recent tool result.
	// Read-only on the frontend (the agent sets it).
	LastObservation interface{} `json:"last_observation,omitempty"`

	// Status: running | paused | done | error | awaiting_human
	Status string `json:"status"`

	// CurrentStep: the step the agent is on.
	CurrentStep int `json:"current_step"`

	// TokensUsed so far (cumulative).
	TokensUsed int `json:"tokens_used"`

	// CostUSD estimated.
	CostUSD float64 `json:"cost_usd"`
}

// ThreadACL defines who can do what to this thread.
// Owner can always do everything. ACLs add shared access.
type ThreadACL struct {
	// Readers can read state and stream events.
	Readers []string `json:"readers,omitempty"`
	// Writers can edit the plan, scratchpad, and trigger runs.
	Writers []string `json:"writers,omitempty"`
	// Admins can change the ACL itself and delete the thread.
	Admins []string `json:"admins,omitempty"`
}

// CanRead returns true if the identity can read this thread.
func (t *Thread) CanRead(id Identity) bool {
	if !t.isLoaded() {
		return false
	}
	if id.UserID == t.OwnerID {
		return true
	}
	if id.Can("admin") {
		return true
	}
	return contains(t.ACL.Readers, id.UserID) || contains(t.ACL.Writers, id.UserID) || contains(t.ACL.Admins, id.UserID)
}

// CanWrite returns true if the identity can edit this thread.
func (t *Thread) CanWrite(id Identity) bool {
	if !t.isLoaded() {
		return false
	}
	if id.UserID == t.OwnerID {
		return true
	}
	if id.Can("admin") {
		return true
	}
	return contains(t.ACL.Writers, id.UserID) || contains(t.ACL.Admins, id.UserID)
}

// CanAdmin returns true if the identity can change ACL or delete.
func (t *Thread) CanAdmin(id Identity) bool {
	if !t.isLoaded() {
		return false
	}
	return id.UserID == t.OwnerID || id.Can("admin") || contains(t.ACL.Admins, id.UserID)
}

func (t *Thread) isLoaded() bool { return t != nil && t.ID != uuid.Nil }

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

// ThreadStore persists threads. The engine reads/writes via this
// interface. Production: Postgres. Tests: in-memory.
type ThreadStore interface {
	Create(ctx context.Context, t *Thread) error
	Get(ctx context.Context, id uuid.UUID) (*Thread, error)
	Update(ctx context.Context, t *Thread) error
	Delete(ctx context.Context, id uuid.UUID) error
	List(ctx context.Context, ownerID string, limit int) ([]*Thread, error)
}

// InMemoryThreadStore is the default — for tests and dev.
type InMemoryThreadStore struct {
	mu       sync.RWMutex
	threads  map[uuid.UUID]*Thread
	byOwner  map[string][]uuid.UUID
}

func NewInMemoryThreadStore() *InMemoryThreadStore {
	return &InMemoryThreadStore{
		threads: make(map[uuid.UUID]*Thread),
		byOwner: make(map[string][]uuid.UUID),
	}
}

func (s *InMemoryThreadStore) Create(ctx context.Context, t *Thread) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now()
	}
	t.UpdatedAt = time.Now()
	s.threads[t.ID] = t
	s.byOwner[t.OwnerID] = append(s.byOwner[t.OwnerID], t.ID)
	return nil
}

func (s *InMemoryThreadStore) Get(ctx context.Context, id uuid.UUID) (*Thread, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.threads[id]
	if !ok {
		return nil, fmt.Errorf("thread %s not found", id)
	}
	return t, nil
}

func (s *InMemoryThreadStore) Update(ctx context.Context, t *Thread) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.threads[t.ID]; !ok {
		return fmt.Errorf("thread %s not found", t.ID)
	}
	t.UpdatedAt = time.Now()
	s.threads[t.ID] = t
	return nil
}

func (s *InMemoryThreadStore) Delete(ctx context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.threads[id]
	if !ok {
		return fmt.Errorf("thread %s not found", id)
	}
	delete(s.threads, id)
	// Remove from byOwner
	for i, tid := range s.byOwner[t.OwnerID] {
		if tid == id {
			s.byOwner[t.OwnerID] = append(s.byOwner[t.OwnerID][:i], s.byOwner[t.OwnerID][i+1:]...)
			break
		}
	}
	return nil
}

func (s *InMemoryThreadStore) List(ctx context.Context, ownerID string, limit int) ([]*Thread, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := s.byOwner[ownerID]
	if limit > 0 && len(ids) > limit {
		ids = ids[:limit]
	}
	out := make([]*Thread, 0, len(ids))
	for _, id := range ids {
		if t, ok := s.threads[id]; ok {
			out = append(out, t)
		}
	}
	return out, nil
}

// ErrUnauthorized is returned when an identity lacks permission.
var ErrUnauthorized = errors.New("unauthorized")
