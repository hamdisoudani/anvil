package core

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CheckpointStoreConfig controls how `NewCheckpointStore` chooses a
// backend. Either Postgres (production) or in-memory (tests + local
// dev). The interface is small and you can write your own impl for
// Redis, S3, BadgerDB, etc — see `Custom` below.
//
// LangGraph analogy:
//   - Postgres  → LangGraph's Postgres checkpointer
//   - Memory    → LangGraph's MemorySaver (default for dev)
//   - Custom    → Your own SqliteCheckpointer / RedisCheckpointer
type CheckpointStoreConfig struct {
	// "postgres" — uses PostgresURL
	// "memory"   — in-process map, lost on restart
	// "custom"   — uses Custom (escape hatch)
	Type string

	// Required when Type == "postgres". Standard pgx URL:
	//   postgres://user:pass@host:5432/dbname?sslmode=disable
	PostgresURL string

	// Required when Type == "custom". Receives a context, returns
	// your own CheckpointStore impl, or an error.
	Custom func(ctx context.Context) (CheckpointStore, error)

	// Optional. Max time to wait when opening the store. Default 10s.
	ConnectTimeout time.Duration
}

// NewCheckpointStore constructs a CheckpointStore from a config.
// Returns an error if the backend can't be reached (so callers can
// fail fast at startup rather than mid-session).
//
// The pattern mirrors LangGraph's `Checkpointer.fromConfig(...)`:
//   - MemoryCheckpointer: in-memory, fast, lost on restart
//   - PostgresCheckpointer: durable, recommended for production
//   - Custom: you implement `core.CheckpointStore` (Save / Load / Latest)
func NewCheckpointStore(ctx context.Context, cfg CheckpointStoreConfig) (CheckpointStore, error) {
	timeout := cfg.ConnectTimeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	switch cfg.Type {
	case "memory", "":
		// Default: in-memory. Use for tests, CI, single-process demos.
		return NewInMemoryCheckpointStore(), nil

	case "postgres":
		if cfg.PostgresURL == "" {
			return nil, fmt.Errorf("checkpoint store: PostgresURL required for type=postgres")
		}
		pool, err := pgxpool.New(ctx, cfg.PostgresURL)
		if err != nil {
			return nil, fmt.Errorf("checkpoint store: connect postgres: %w", err)
		}
		// Verify the connection is alive.
		if err := pool.Ping(ctx); err != nil {
			pool.Close()
			return nil, fmt.Errorf("checkpoint store: ping postgres: %w", err)
		}
		return NewPostgresCheckpointStore(pool), nil

	case "custom":
		if cfg.Custom == nil {
			return nil, fmt.Errorf("checkpoint store: Custom function required for type=custom")
		}
		store, err := cfg.Custom(ctx)
		if err != nil {
			return nil, fmt.Errorf("checkpoint store: custom: %w", err)
		}
		return store, nil

	default:
		return nil, fmt.Errorf("checkpoint store: unknown type %q (want postgres | memory | custom)", cfg.Type)
	}
}

// schemaFor returns the DDL needed for the underlying store. Useful
// for `make migrate` scripts or first-run setup.
func SchemaFor(store CheckpointStore) (string, bool) {
	type schemaProvider interface {
		Schema() string
	}
	if sp, ok := store.(schemaProvider); ok {
		return sp.Schema(), true
	}
	return "", false
}

// Compile-time check that the in-memory store is exported under the
// expected name.
var _ CheckpointStore = (*InMemoryCheckpointStore)(nil)
var _ CheckpointStore = (*PostgresCheckpointStore)(nil)

// Ensure uuid is referenced (used by State which is in store.go).
var _ = uuid.Nil