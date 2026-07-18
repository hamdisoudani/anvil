package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresEventStore is the production EventStore implementation.
// The event log is the source of truth. Schema:
//
//   CREATE TABLE events (
//     session_id  UUID NOT NULL,
//     id          BIGSERIAL,
//     event_id    TEXT NOT NULL,           -- client-visible monotonic
//     type        TEXT NOT NULL,
//     payload     JSONB NOT NULL,
//     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
//     PRIMARY KEY (session_id, id)
//   );
//   CREATE INDEX idx_events_session_id ON events(session_id, id);
//
// Append is one INSERT. Since() is one SELECT. Stream() uses LISTEN/NOTIFY
// in production; this implementation polls the log every 100ms (good
// enough for tests and small deployments; swap for LISTEN/NOTIFY at scale).
type PostgresEventStore struct {
	pool *pgxpool.Pool
}

// NewPostgresEventStore creates a new Postgres-backed event store.
func NewPostgresEventStore(pool *pgxpool.Pool) *PostgresEventStore {
	return &PostgresEventStore{pool: pool}
}

// Append inserts an event. Returns the assigned ID (the bigserial).
func (s *PostgresEventStore) Append(ctx context.Context, e Event) (int64, error) {
	payload, err := json.Marshal(e.Payload)
	if err != nil {
		return 0, fmt.Errorf("marshal payload: %w", err)
	}
	eventID := uuid.New().String()
	if e.ID > 0 {
		eventID = strconvFormatInt(e.ID)
	}
	var id int64
	err = s.pool.QueryRow(ctx, `
		INSERT INTO events (session_id, event_id, type, payload, created_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, e.SessionID, eventID, string(e.Type), payload, e.CreatedAt).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert event: %w", err)
	}
	return id, nil
}

// Since returns events with id > afterEventID, ordered by id.
func (s *PostgresEventStore) Since(ctx context.Context, sessionID uuid.UUID, afterEventID int64, limit int) ([]Event, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, event_id, type, payload, created_at
		FROM events
		WHERE session_id = $1 AND id > $2
		ORDER BY id ASC
		LIMIT $3
	`, sessionID, afterEventID, limit)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var out []Event
	for rows.Next() {
		var e Event
		var eventID, typeStr string
		var payload []byte
		if err := rows.Scan(&e.ID, &eventID, &typeStr, &payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.SessionID = sessionID
		e.Type = EventType(typeStr)
		if err := json.Unmarshal(payload, &e.Payload); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

// GetByID fetches a single event.
func (s *PostgresEventStore) GetByID(ctx context.Context, sessionID uuid.UUID, eventID int64) (Event, error) {
	var e Event
	var eventIDStr, typeStr string
	var payload []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, event_id, type, payload, created_at
		FROM events
		WHERE session_id = $1 AND id = $2
	`, sessionID, eventID).Scan(&e.ID, &eventIDStr, &typeStr, &payload, &e.CreatedAt)
	if err != nil {
		return Event{}, err
	}
	e.SessionID = sessionID
	e.Type = EventType(typeStr)
	_ = json.Unmarshal(payload, &e.Payload)
	return e, nil
}

// Stream returns a channel that yields events as they're appended.
// Polls the database every 100ms. For low-latency production, replace
// with LISTEN/NOTIFY (Postgres) or a CDC stream (Debezium, etc.).
func (s *PostgresEventStore) Stream(ctx context.Context, sessionID uuid.UUID, afterEventID int64) (<-chan Event, error) {
	ch := make(chan Event, 64)
	go func() {
		defer close(ch)
		cursor := afterEventID
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				events, err := s.Since(ctx, sessionID, cursor, 100)
				if err != nil {
					continue // log + retry on real impl
				}
				for _, e := range events {
					select {
					case ch <- e:
						cursor = e.ID
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()
	return ch, nil
}

// Schema returns the DDL needed to set up the events table.
// Run this once at deployment time.
func (s *PostgresEventStore) Schema() string {
	return `
		CREATE TABLE IF NOT EXISTS events (
			session_id  UUID NOT NULL,
			id          BIGSERIAL,
			event_id    TEXT NOT NULL,
			type        TEXT NOT NULL,
			payload     JSONB NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (session_id, id)
		);
		CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id, id);
	`
}

// PostgresCheckpointStore is the production CheckpointStore.
type PostgresCheckpointStore struct {
	pool *pgxpool.Pool
}

// NewPostgresCheckpointStore creates a new Postgres-backed checkpoint store.
func NewPostgresCheckpointStore(pool *pgxpool.Pool) *PostgresCheckpointStore {
	return &PostgresCheckpointStore{pool: pool}
}

// Save upserts the checkpoint for a session.
func (s *PostgresCheckpointStore) Save(ctx context.Context, state State) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO checkpoints (session_id, step, state, last_event_id, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (session_id) DO UPDATE
		SET step = $2, state = $3, last_event_id = $4, updated_at = $5
	`, state.SessionID, state.Step, payload, state.LastEventID, state.UpdatedAt)
	return err
}

// Load returns the latest checkpoint for a session.
func (s *PostgresCheckpointStore) Load(ctx context.Context, sessionID uuid.UUID) (State, error) {
	var payload []byte
	err := s.pool.QueryRow(ctx, `
		SELECT state FROM checkpoints WHERE session_id = $1
	`, sessionID).Scan(&payload)
	if err != nil {
		return State{}, err
	}
	var state State
	if err := json.Unmarshal(payload, &state); err != nil {
		return State{}, err
	}
	return state, nil
}

// Latest is an alias for Load.
func (s *PostgresCheckpointStore) Latest(ctx context.Context, sessionID uuid.UUID) (State, error) {
	return s.Load(ctx, sessionID)
}

// Schema returns the DDL for the checkpoints table.
func (s *PostgresCheckpointStore) Schema() string {
	return `
		CREATE TABLE IF NOT EXISTS checkpoints (
			session_id    UUID PRIMARY KEY,
			step          INT NOT NULL,
			state         JSONB NOT NULL,
			last_event_id BIGINT NOT NULL,
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
		);
	`
}

// strconvFormatInt is a helper to avoid importing strconv in the file header.
func strconvFormatInt(n int64) string {
	return strconv.FormatInt(n, 10)
}

// Compile-time checks
var (
	_ EventStore      = (*PostgresEventStore)(nil)
	_ CheckpointStore = (*PostgresCheckpointStore)(nil)
)

// sentinel for callers
var errNoCheckpoint = errors.New("no checkpoint for session")
