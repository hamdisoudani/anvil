# Checkpoint stores

Anvil's `core.Agent` is a LangGraph-style stateful engine. To enable
resume-after-crash, attach a `CheckpointStore` via `WithCheckpointStore`.

## Built-in implementations

| Backend | When to use | Constructor |
|---|---|---|
| **In-memory** | Tests, CI, single-process demos. Lost on restart. | `NewInMemoryCheckpointStore()` |
| **Postgres** | Production. Durable across restarts. | `NewPostgresCheckpointStore(pool)` |
| **Custom** | Redis, SQLite, S3, BadgerDB — anything. | Your own `core.CheckpointStore` impl |

## Factory (recommended)

Use `NewCheckpointStore(ctx, cfg)` to pick a backend from config:

```go
import "github.com/hamdisoudani/anvil/internal/core"

store, err := core.NewCheckpointStore(ctx, core.CheckpointStoreConfig{
    Type:        "postgres",       // or "memory" or "custom"
    PostgresURL: os.Getenv("DATABASE_URL"),
    ConnectTimeout: 10 * time.Second,
})
if err != nil {
    log.Fatal(err)
}
defer pgxPool.Close() // for postgres

agent := core.New(
    core.WithCheckpointStore(store),
    core.WithLLM(router),
    // ... other options
)
```

## Wiring the agent

The factory returns any `core.CheckpointStore` — same interface
either way:

```go
// Saving: done automatically by the loop, every cfg.CheckpointEvery steps
// Loading: done by core.Agent.Resume(ctx, sessionID) — see internal/core/agent.go

sess, sub, err := agent.Resume(ctx, sessionID)
if err != nil {
    // No checkpoint for this session — start a new one
    sess, sub, err = agent.Run(ctx, task)
}
```

## Writing your own (escape hatch)

Implement three methods:

```go
type CheckpointStore interface {
    Save(ctx context.Context, state State) error
    Load(ctx context.Context, sessionID uuid.UUID) (State, error)
    Latest(ctx context.Context, sessionID uuid.UUID) (State, error)
}
```

Then either pass it via `WithCheckpointStore(myStore)` directly, or
register it via the factory's `Custom` hook:

```go
store, _ := core.NewCheckpointStore(ctx, core.CheckpointStoreConfig{
    Type: "custom",
    Custom: func(ctx context.Context) (core.CheckpointStore, error) {
        return myRedisStore, nil
    },
})
```

## Postgres schema

`NewPostgresCheckpointStore(pool)` ships with a DDL string returned
by `store.Schema()`:

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
    session_id    UUID PRIMARY KEY,
    step          INT NOT NULL,
    state         JSONB NOT NULL,
    last_event_id BIGINT NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Run this once at deploy time:

```go
ddl, _ := core.SchemaFor(store)
_, err := pool.Exec(ctx, ddl)
```

## Frequency

`WithConfig(core.Config{CheckpointEvery: 5})` (default) snapshots
every 5 steps. Smaller = faster resume, more writes. Bigger = fewer
writes, longer recovery. For LLM-heavy agents, 5 is the sweet spot.