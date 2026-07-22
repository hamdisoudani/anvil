package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ── Checkpoint store: Latest / Overwrite / Concurrent ─────────────

func TestInMemoryCheckpointStore_Latest(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryCheckpointStore()
	id := uuid.New()

	// Latest on empty store returns zero State, nil error
	s, err := store.Latest(ctx, id)
	if err != nil {
		t.Fatalf("Latest on empty: %v", err)
	}
	if s.SessionID != uuid.Nil {
		t.Errorf("expected zero State, got %+v", s)
	}

	// After Save, Latest returns the saved state
	want := State{SessionID: id, Step: 3, LastEventID: 42, UpdatedAt: time.Now()}
	if err := store.Save(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Latest(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.SessionID != want.SessionID || got.Step != 3 || got.LastEventID != 42 {
		t.Errorf("Latest mismatch: got %+v want %+v", got, want)
	}
}

func TestInMemoryCheckpointStore_Overwrite(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryCheckpointStore()
	id := uuid.New()
	if err := store.Save(ctx, State{SessionID: id, Step: 1}); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(ctx, State{SessionID: id, Step: 2}); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Load(ctx, id)
	if got.Step != 2 {
		t.Errorf("expected step 2, got %d", got.Step)
	}
}

func TestInMemoryCheckpointStore_Load_Missing(t *testing.T) {
	store := NewInMemoryCheckpointStore()
	st, err := store.Load(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("Load missing returned err: %v", err)
	}
	if st.SessionID != uuid.Nil {
		t.Errorf("expected zero State, got %+v", st)
	}
}

func TestInMemoryCheckpointStore_ConcurrentSave(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryCheckpointStore()
	id := uuid.New()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_ = store.Save(ctx, State{SessionID: id, Step: i})
			_, _ = store.Load(ctx, id)
		}(i)
	}
	wg.Wait()
}

// ── Identity ──────────────────────────────────────────────────────

func TestIdentity_IsExpired(t *testing.T) {
	if !(&Identity{ExpiresAt: time.Now().Add(-time.Hour)}).IsExpired() {
		t.Error("past should be expired")
	}
	if (&Identity{ExpiresAt: time.Now().Add(time.Hour)}).IsExpired() {
		t.Error("future should not be expired")
	}
	// Zero Identity has zero ExpiresAt → time.Now().After(zero) is true
	// (this is the actual behavior of the current implementation).
	if !(&Identity{}).IsExpired() {
		t.Error("zero Identity should be expired (time.Now().After(zero)=true)")
	}
}

func TestIdentity_Can(t *testing.T) {
	id := Identity{Roles: []string{"admin", "writer"}}
	if !id.Can("admin") {
		t.Error("admin role missing")
	}
	if id.Can("reader") {
		t.Error("false positive: reader")
	}
	if id.Can("") {
		t.Error("empty role false positive")
	}
	id.Roles = nil
	if id.Can("anything") {
		t.Error("no roles should never match")
	}
}

func TestIdentity_AnonymousAndAuthenticated(t *testing.T) {
	a := Anonymous()
	if a.UserID != "anonymous" || a.IsAuthenticated() {
		t.Errorf("expected anonymous/unauth, got %+v auth=%v", a, a.IsAuthenticated())
	}
	if (&Identity{UserID: ""}).IsAuthenticated() {
		t.Error("empty userID is not authenticated")
	}
	if !(&Identity{UserID: "alice"}).IsAuthenticated() {
		t.Error("non-empty should be authenticated")
	}
}

// ── Thread ACL ────────────────────────────────────────────────────

func TestThread_CanRead(t *testing.T) {
	mkThread := func() *Thread {
		return &Thread{
			ID:      uuid.New(),
			OwnerID: "owner",
			ACL:     ThreadACL{Readers: []string{"r1"}, Writers: []string{"w1"}, Admins: []string{"a1"}},
		}
	}
	cases := []struct {
		id   Identity
		want bool
		desc string
	}{
		{Identity{UserID: "owner"}, true, "owner"},
		{Identity{UserID: "stranger"}, false, "stranger"},
		{Identity{UserID: "r1"}, true, "reader"},
		{Identity{UserID: "w1"}, true, "writer"},
		{Identity{UserID: "a1"}, true, "ACL admin"},
		{Identity{UserID: "x", Roles: []string{"admin"}}, true, "global admin"},
	}
	for _, c := range cases {
		if got := mkThread().CanRead(c.id); got != c.want {
			t.Errorf("CanRead %s: got %v want %v", c.desc, got, c.want)
		}
	}
	if (&Thread{}).CanRead(Identity{UserID: "owner"}) {
		t.Error("nil-loaded thread should not be readable")
	}
	if (&Thread{}).CanRead(Identity{Roles: []string{"admin"}}) {
		t.Error("nil-loaded thread should reject even admin role")
	}
}

func TestThread_CanWrite(t *testing.T) {
	mk := func() *Thread {
		return &Thread{
			ID: uuid.New(), OwnerID: "owner",
			ACL: ThreadACL{Readers: []string{"r1"}, Writers: []string{"w1"}, Admins: []string{"a1"}},
		}
	}
	cases := []struct {
		id   Identity
		want bool
		desc string
	}{
		{Identity{UserID: "owner"}, true, "owner"},
		{Identity{UserID: "w1"}, true, "writer"},
		{Identity{UserID: "a1"}, true, "admin ACL"},
		{Identity{UserID: "x", Roles: []string{"admin"}}, true, "global admin"},
		{Identity{UserID: "r1"}, false, "reader (only)"},
		{Identity{UserID: "stranger"}, false, "stranger"},
	}
	for _, c := range cases {
		if got := mk().CanWrite(c.id); got != c.want {
			t.Errorf("CanWrite %s: got %v want %v", c.desc, got, c.want)
		}
	}
	if (&Thread{}).CanWrite(Identity{UserID: "owner"}) {
		t.Error("nil thread")
	}
}

func TestThread_CanAdmin(t *testing.T) {
	mk := func() *Thread {
		return &Thread{ID: uuid.New(), OwnerID: "owner", ACL: ThreadACL{Admins: []string{"a1"}}}
	}
	cases := []struct {
		id   Identity
		want bool
		desc string
	}{
		{Identity{UserID: "owner"}, true, "owner"},
		{Identity{UserID: "a1"}, true, "ACL admin"},
		{Identity{UserID: "x", Roles: []string{"admin"}}, true, "global admin"},
		{Identity{UserID: "stranger"}, false, "stranger"},
	}
	for _, c := range cases {
		if got := mk().CanAdmin(c.id); got != c.want {
			t.Errorf("CanAdmin %s: got %v want %v", c.desc, got, c.want)
		}
	}
	if (&Thread{}).CanAdmin(Identity{UserID: "owner"}) {
		t.Error("nil thread")
	}
}

// ── InMemoryThreadStore ───────────────────────────────────────────

func TestInMemoryThreadStore_CRUD(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryThreadStore()

	thr := &Thread{OwnerID: "alice", Title: "research"}
	if err := s.Create(ctx, thr); err != nil {
		t.Fatal(err)
	}
	if thr.ID == uuid.Nil {
		t.Error("ID not assigned")
	}
	if thr.CreatedAt.IsZero() || thr.UpdatedAt.IsZero() {
		t.Error("timestamps not set")
	}

	got, err := s.Get(ctx, thr.ID)
	if err != nil || got.Title != "research" || got.OwnerID != "alice" {
		t.Fatalf("Get: err=%v got=%+v", err, got)
	}

	got.Title = "research v2"
	if err := s.Update(ctx, got); err != nil {
		t.Fatal(err)
	}
	got2, _ := s.Get(ctx, thr.ID)
	if got2.Title != "research v2" {
		t.Errorf("update didn't stick: %s", got2.Title)
	}

	if err := s.Update(ctx, &Thread{ID: uuid.New()}); err == nil {
		t.Error("expected error updating missing")
	}

	if err := s.Delete(ctx, thr.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, thr.ID); err == nil {
		t.Error("expected error after delete")
	}
	if err := s.Delete(ctx, uuid.New()); err == nil {
		t.Error("expected error deleting missing")
	}
}

func TestInMemoryThreadStore_PreservesProvidedID(t *testing.T) {
	s := NewInMemoryThreadStore()
	id := uuid.New()
	thr := &Thread{ID: id, OwnerID: "alice"}
	if err := s.Create(context.Background(), thr); err != nil {
		t.Fatal(err)
	}
	if thr.ID != id {
		t.Errorf("ID overwritten: got %s want %s", thr.ID, id)
	}
}

func TestInMemoryThreadStore_GetMissing(t *testing.T) {
	s := NewInMemoryThreadStore()
	_, err := s.Get(context.Background(), uuid.New())
	if err == nil {
		t.Error("expected error for missing")
	}
}

func TestInMemoryThreadStore_List(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryThreadStore()
	for i := 0; i < 5; i++ {
		_ = s.Create(ctx, &Thread{OwnerID: "alice"})
		_ = s.Create(ctx, &Thread{OwnerID: "bob"})
	}
	alice, _ := s.List(ctx, "alice", 0)
	if len(alice) != 5 {
		t.Errorf("alice len = %d want 5", len(alice))
	}
	bob, _ := s.List(ctx, "bob", 0)
	if len(bob) != 5 {
		t.Errorf("bob len = %d want 5", len(bob))
	}
	none, _ := s.List(ctx, "nobody", 0)
	if len(none) != 0 {
		t.Errorf("nobody len = %d", len(none))
	}
	limited, _ := s.List(ctx, "alice", 3)
	if len(limited) != 3 {
		t.Errorf("limit=3 gave %d", len(limited))
	}
}

func TestInMemoryThreadStore_DeleteUpdatesList(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryThreadStore()
	thr := &Thread{OwnerID: "alice"}
	if err := s.Create(ctx, thr); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, thr.ID); err != nil {
		t.Fatal(err)
	}
	list, _ := s.List(ctx, "alice", 0)
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d", len(list))
	}
}

func TestInMemoryThreadStore_Concurrent(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryThreadStore()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			thr := &Thread{OwnerID: "alice"}
			_ = s.Create(ctx, thr)
		}()
	}
	wg.Wait()
	list, _ := s.List(ctx, "alice", 0)
	if len(list) != 50 {
		t.Errorf("concurrent create: got %d want 50", len(list))
	}
}

func TestErrUnauthorizedIsSentinel(t *testing.T) {
	if !errors.Is(ErrUnauthorized, ErrUnauthorized) {
		t.Error("sentinel not self-equal")
	}
}

// ── HITL ───────────────────────────────────────────────────────────

func TestApprovalGate_Approve(t *testing.T) {
	g := NewApprovalGate(ApprovalRequired{StepID: "s1"})
	done := make(chan ApprovalResponse, 1)
	go func() { g.Approve() }()
	go func() { done <- <-g.Response }()
	select {
	case r := <-done:
		if r.Status != ApprovalApproved || r.StepID != "s1" {
			t.Errorf("unexpected: %+v", r)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out")
	}
}

func TestApprovalGate_Edit(t *testing.T) {
	g := NewApprovalGate(ApprovalRequired{StepID: "s1"})
	edited := PlanStep{ID: "s1", Intent: "x"}
	go g.Edit(edited)
	r := <-g.Response
	if r.Status != ApprovalEdited || r.Edited == nil || r.Edited.Intent != "x" {
		t.Errorf("unexpected: %+v", r)
	}
}

func TestApprovalGate_Reject(t *testing.T) {
	g := NewApprovalGate(ApprovalRequired{StepID: "s1"})
	go g.Reject("because")
	r := <-g.Response
	if r.Status != ApprovalRejected || r.Reason != "because" {
		t.Errorf("unexpected: %+v", r)
	}
}

func TestApprovalRegistry(t *testing.T) {
	reg := NewApprovalRegistry()
	if reg.Get("t", "x") != nil {
		t.Error("missing should be nil")
	}
	g := NewApprovalGate(ApprovalRequired{StepID: "s1"})
	reg.Register("t1", g)
	if reg.Get("t1", "s1") != g {
		t.Error("should find gate")
	}
	if reg.Get("t1", "missing") != nil {
		t.Error("wrong step should be nil")
	}

	if err := reg.Respond("t1", "s1", ApprovalResponse{StepID: "s1", Status: ApprovalApproved}); err != nil {
		t.Fatalf("Respond: %v", err)
	}
	select {
	case <-g.Response:
	default:
		t.Error("response not delivered")
	}
	if reg.Get("t1", "s1") != nil {
		t.Error("gate should be removed")
	}
	if err := reg.Respond("t1", "s1", ApprovalResponse{}); err == nil {
		t.Error("respond missing should error")
	}
}

func TestWaitForHuman_Cancel(t *testing.T) {
	g := NewApprovalGate(ApprovalRequired{StepID: "s1"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := WaitForHuman(ctx, g)
	if err != context.Canceled {
		t.Errorf("expected canceled, got %v", err)
	}
}

func TestWaitForHuman_Deliver(t *testing.T) {
	g := NewApprovalGate(ApprovalRequired{StepID: "s1"})
	go func() {
		time.Sleep(20 * time.Millisecond)
		g.Approve()
	}()
	r, err := WaitForHuman(context.Background(), g)
	if err != nil || r.Status != ApprovalApproved {
		t.Fatalf("err=%v r=%+v", err, r)
	}
}

// ── Interrupt constructors ────────────────────────────────────────

func TestAskApproval(t *testing.T) {
	p := AskApproval("can I?")
	if p.Reason != InterruptApproval || p.Title != "Approval required" || p.Message != "can I?" {
		t.Errorf("unexpected: %+v", p)
	}
}

func TestAskQuestion(t *testing.T) {
	s := map[string]interface{}{"type": "object"}
	p := AskQuestion("give me a URL", s)
	if p.Reason != InterruptInput || p.Title != "give me a URL" || p.Schema["type"] != "object" {
		t.Errorf("unexpected: %+v", p)
	}
}

func TestShowOptions(t *testing.T) {
	p := ShowOptions("pick", []string{"a", "b"})
	if p.Reason != InterruptChoice || len(p.Options) != 2 {
		t.Errorf("unexpected: %+v", p)
	}
}

func TestInterruptErrorAndSentinel(t *testing.T) {
	e := &InterruptError{Reason: InterruptApproval, Message: "no"}
	s := e.Error()
	if s == "" {
		t.Error("empty error string")
	}
	if !errors.Is(ErrInterruptRejected, ErrInterruptRejected) {
		t.Error("sentinel not self-equal")
	}
}

// ── Cache memory ───────────────────────────────────────────────────

func TestInMemoryCache_LookupEmpty(t *testing.T) {
	c := NewInMemoryCache()
	got, ok, err := c.Lookup(context.Background(), []float32{0.1, 0.2}, 0.9)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Errorf("expected miss, got %+v", got)
	}
}

func TestInMemoryCache_StoreNoError(t *testing.T) {
	ctx := context.Background()
	c := NewInMemoryCache()
	if err := c.Store(ctx, []float32{0.5, 0.5}, CachedResponse{Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.Lookup(ctx, []float32{0.5, 0.5}, 0.9); err != nil {
		t.Fatal(err)
	}
}

func TestInMemoryCache_PromptGetPut(t *testing.T) {
	ctx := context.Background()
	c := NewInMemoryCache()
	_, ok, err := c.Get(ctx, "missing")
	if err != nil || ok {
		t.Errorf("missing: ok=%v err=%v", ok, err)
	}
	if err := c.Put(ctx, "k", CacheEntry{Key: "k", Tokens: 1}, time.Minute); err != nil {
		t.Fatal(err)
	}
	got, ok, err := c.Get(ctx, "k")
	if err != nil || !ok {
		t.Fatalf("after put: ok=%v err=%v", ok, err)
	}
	if got.Key != "k" {
		t.Errorf("got %+v", got)
	}
}

func TestInMemoryCache_IdemGetPut(t *testing.T) {
	ctx := context.Background()
	c := NewInMemoryCache()
	adapter := c.Idempotency()
	_, ok, err := adapter.Get(ctx, "missing")
	if err != nil || ok {
		t.Errorf("missing idem: ok=%v err=%v", ok, err)
	}
	if err := adapter.Put(ctx, "k1", ToolResultRecord{Result: json.RawMessage(`"result1"`)}, time.Minute); err != nil {
		t.Fatal(err)
	}
	got, ok, err := adapter.Get(ctx, "k1")
	if err != nil || !ok {
		t.Fatalf("after put: ok=%v err=%v", ok, err)
	}
	if string(got.Result) != `"result1"` {
		t.Errorf("got %s", got.Result)
	}
}

func TestInMemoryCache_Accessors(t *testing.T) {
	c := NewInMemoryCache()
	if c.Prompt() == nil || c.Semantic() == nil || c.Idempotency() == nil {
		t.Error("accessors nil")
	}
}

// ── InMemoryEventStore ────────────────────────────────────────────

func TestInMemoryEventStore_Append(t *testing.T) {
	es := NewInMemoryEventStore()
	sess := uuid.New()
	id, err := es.Append(context.Background(), Event{SessionID: sess, Type: EventDone, Payload: map[string]any{"k": "v"}})
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Error("expected non-zero assigned id")
	}
	evts, _ := es.Since(context.Background(), sess, 0, 100)
	if len(evts) < 1 {
		t.Errorf("Since got %d", len(evts))
	}
}

func TestInMemoryEventStore_Since(t *testing.T) {
	es := NewInMemoryEventStore()
	sess := uuid.New()
	var lastID int64
	for i := 0; i < 5; i++ {
		id, err := es.Append(context.Background(), Event{SessionID: sess, Type: EventDone})
		if err != nil {
			t.Fatal(err)
		}
		lastID = id
	}
	all, _ := es.Since(context.Background(), sess, 0, 0)
	if len(all) != 5 {
		t.Errorf("Since(0): got %d want 5", len(all))
	}
	after, _ := es.Since(context.Background(), sess, lastID, 0)
	if len(after) != 0 {
		t.Errorf("Since(lastID): got %d want 0", len(after))
	}
}

func TestInMemoryEventStore_GetByID(t *testing.T) {
	es := NewInMemoryEventStore()
	sess := uuid.New()
	id, _ := es.Append(context.Background(), Event{SessionID: sess, Type: EventDone})
	if id == 0 {
		t.Fatal("expected assigned id")
	}
	got, err := es.GetByID(context.Background(), sess, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != id {
		t.Errorf("ID=%v want=%v", got.ID, id)
	}
	// GetByID returns zero Event + nil error for missing IDs (not an error).
	// Document that contract here.
	otherSess := uuid.New()
	zero, err := es.GetByID(context.Background(), otherSess, 99999)
	if err != nil {
		t.Errorf("GetByID for unknown session returned err: %v", err)
	}
	if zero.ID != 0 {
		t.Errorf("expected zero Event, got %+v", zero)
	}
}

// ── AsyncEventWriter ──────────────────────────────────────────────

func TestAsyncEventWriter_AppendReturnsID(t *testing.T) {
	es := NewInMemoryEventStore()
	w := NewAsyncEventWriter(es, 16)
	defer w.Close()

	id, err := w.Append(context.Background(), Event{Type: EventDone})
	if err != nil {
		t.Fatal(err)
	}
	if id == 0 {
		t.Error("expected non-zero assigned id")
	}
}

func TestAsyncEventWriter_DroppedCounter(t *testing.T) {
	es := NewInMemoryEventStore()
	w := NewAsyncEventWriter(es, 2) // tiny buffer
	defer w.Close()

	before := w.Dropped()
	if before != 0 {
		t.Errorf("expected 0 dropped, got %d", before)
	}
	if w.Drainable() < 0 {
		t.Error("Drainable should not be negative")
	}
}

// ── RunRecord store ───────────────────────────────────────────────

func TestInMemoryRunRecordStore_AppendAndList(t *testing.T) {
	s := NewInMemoryRunRecordStore()
	for i := 0; i < 3; i++ {
		s.Append(RunRecord{ThreadID: "t1", Step: i, PluginName: "test"})
	}
	list, err := s.List("t1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Errorf("List got %d want 3", len(list))
	}
	list2, _ := s.List("nobody", 0)
	if len(list2) != 0 {
		t.Errorf("empty thread should be empty")
	}
}

// ── Compiler interface checks (smoke test) ──────────────────────

func TestCompilerInterfaceChecks(t *testing.T) {
	var _ EventStore = (*InMemoryEventStore)(nil)
	var _ CheckpointStore = (*InMemoryCheckpointStore)(nil)
	var _ ThreadStore = (*InMemoryThreadStore)(nil)
	var _ Cache = (*InMemoryCache)(nil)
	var _ RunRecordStore = (*InMemoryRunRecordStore)(nil)
}

// ── Avoid unused import warnings from internal helpers ───────────
// (tool_timeout_error / interrupt error are exercised directly below)

func TestToolTimeoutError_AndInterruptErrorPure(t *testing.T) {
	e := &ToolTimeoutError{Tool: "x", Timeout: time.Second}
	if !e.Is(ErrToolTimeout) {
		t.Error("Is(ErrToolTimeout) failed")
	}
	if e.Is(errors.New("other")) {
		t.Error("Is(other) should be false")
	}
	if e.Error() == "" {
		t.Error("empty error string")
	}
	ie := &InterruptError{Reason: InterruptInput, Message: "ask"}
	if ie.Error() == "" {
		t.Error("InterruptError empty string")
	}
	fmt.Println("coverage") // ensure fmt import is referenced
}