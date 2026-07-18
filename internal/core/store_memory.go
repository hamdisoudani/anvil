package core

import (
	"context"
	"sync"

	"github.com/google/uuid"
)

// InMemoryEventStore is a tiny implementation for tests and local dev.
// Production uses PostgresEventStore in store_pg.go.
type InMemoryEventStore struct {
	mu     sync.RWMutex
	events map[uuid.UUID][]Event
}

func NewInMemoryEventStore() *InMemoryEventStore {
	return &InMemoryEventStore{events: make(map[uuid.UUID][]Event)}
}

func (s *InMemoryEventStore) Append(ctx context.Context, e Event) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.events[e.SessionID]
	e.ID = int64(len(list) + 1)
	s.events[e.SessionID] = append(list, e)
	return e.ID, nil
}

func (s *InMemoryEventStore) Since(ctx context.Context, sessionID uuid.UUID, afterEventID int64, limit int) ([]Event, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := s.events[sessionID]
	var out []Event
	for _, e := range list {
		if e.ID > afterEventID {
			out = append(out, e)
			if limit > 0 && len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (s *InMemoryEventStore) GetByID(ctx context.Context, sessionID uuid.UUID, eventID int64) (Event, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := s.events[sessionID]
	for _, e := range list {
		if e.ID == eventID {
			return e, nil
		}
	}
	return Event{}, nil
}

func (s *InMemoryEventStore) Stream(ctx context.Context, sessionID uuid.UUID, afterEventID int64) (<-chan Event, error) {
	ch := make(chan Event, 64)
	go func() {
		defer close(ch)
		s.mu.RLock()
		list := make([]Event, len(s.events[sessionID]))
		copy(list, s.events[sessionID])
		s.mu.RUnlock()
		for _, e := range list {
			if e.ID > afterEventID {
				select {
				case ch <- e:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return ch, nil
}

// InMemoryCheckpointStore — separate from events.
type InMemoryCheckpointStore struct {
	mu   sync.RWMutex
	data map[uuid.UUID]State
}

func NewInMemoryCheckpointStore() *InMemoryCheckpointStore {
	return &InMemoryCheckpointStore{data: make(map[uuid.UUID]State)}
}

func (s *InMemoryCheckpointStore) Save(ctx context.Context, state State) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[state.SessionID] = state
	return nil
}

func (s *InMemoryCheckpointStore) Load(ctx context.Context, sessionID uuid.UUID) (State, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if st, ok := s.data[sessionID]; ok {
		return st, nil
	}
	return State{}, nil
}

func (s *InMemoryCheckpointStore) Latest(ctx context.Context, sessionID uuid.UUID) (State, error) {
	return s.Load(ctx, sessionID)
}
