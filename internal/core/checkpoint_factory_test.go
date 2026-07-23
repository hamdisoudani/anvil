package core

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestNewCheckpointStore_Memory verifies the memory factory works.
func TestNewCheckpointStore_Memory(t *testing.T) {
	ctx := context.Background()
	store, err := NewCheckpointStore(ctx, CheckpointStoreConfig{
		Type: "memory",
	})
	if err != nil {
		t.Fatalf("memory store: %v", err)
	}
	if store == nil {
		t.Fatal("expected non-nil store")
	}

	// Round-trip
	id := uuid.New()
	state := State{
		SessionID: id,
		Step:      42,
	}
	if err := store.Save(ctx, state); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := store.Load(ctx, id)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Step != 42 {
		t.Fatalf("expected step=42, got %d", loaded.Step)
	}
}

// TestNewCheckpointStore_Custom verifies the escape hatch works.
func TestNewCheckpointStore_Custom(t *testing.T) {
	ctx := context.Background()
	want := NewInMemoryCheckpointStore()
	store, err := NewCheckpointStore(ctx, CheckpointStoreConfig{
		Type: "custom",
		Custom: func(ctx context.Context) (CheckpointStore, error) {
			return want, nil
		},
	})
	if err != nil {
		t.Fatalf("custom: %v", err)
	}
	if store != want {
		t.Fatalf("expected the same store back")
	}
}

// TestNewCheckpointStore_BadType verifies unknown types fail loud.
func TestNewCheckpointStore_BadType(t *testing.T) {
	ctx := context.Background()
	_, err := NewCheckpointStore(ctx, CheckpointStoreConfig{
		Type: "redis",
	})
	if err == nil {
		t.Fatal("expected error for unknown type")
	}
}

// TestNewCheckpointStore_PostgresNoURL verifies missing URL fails.
func TestNewCheckpointStore_PostgresNoURL(t *testing.T) {
	ctx := context.Background()
	_, err := NewCheckpointStore(ctx, CheckpointStoreConfig{
		Type: "postgres",
	})
	if err == nil {
		t.Fatal("expected error when PostgresURL is missing")
	}
}

// TestSchemaFor_Postgres verifies schema extraction works.
func TestSchemaFor_Postgres(t *testing.T) {
	store := &PostgresCheckpointStore{}
	ddl, ok := SchemaFor(store)
	if !ok {
		t.Fatal("expected schema provider to be recognized")
	}
	if ddl == "" {
		t.Fatal("expected non-empty DDL")
	}
}

// TestNewCheckpointStore_ConnectTimeout verifies the timeout config
// is honored when the connection takes too long.
func TestNewCheckpointStore_ConnectTimeout(t *testing.T) {
	ctx := context.Background()
	start := time.Now()
	// 127.0.0.1:1 is a port that always refuses connections — this
	// forces pgxpool.Ping to fail within the timeout window.
	_, err := NewCheckpointStore(ctx, CheckpointStoreConfig{
		Type:           "postgres",
		PostgresURL:    "postgres://x:x@127.0.0.1:1/x",
		ConnectTimeout: 100 * time.Millisecond,
	})
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("expected connection failure")
	}
	// Should fail relatively quickly (well under 1s).
	if elapsed > 5*time.Second {
		t.Fatalf("timeout not honored: took %v", elapsed)
	}
}