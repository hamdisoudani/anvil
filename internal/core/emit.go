package core

import (
	"context"
	"sync/atomic"
	"time"
)

// emit is the central fanout. It:
//  1. Persists the event (async, non-blocking — see AsyncEventWriter)
//  2. Fans out to all subscribers
//  3. Tracks dropped events per subscriber (no silent loss)
//
// The old design blocked on store.Append and silently dropped slow
// subscribers. This one is non-blocking on both paths, with visible
// counters so operators can see when something's wrong.
func (s *Session) emit(e Event) {
	e.SessionID = s.State.SessionID
	if e.CreatedAt.IsZero() {
		e.CreatedAt = time.Now()
	}

	// 1. Persist (async). Store gets a fresh context so a cancelled
	// session context doesn't kill the writer.
	writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if s.writer != nil {
		s.writer.Append(writeCtx, e)
	} else {
		// Fallback: synchronous write (tests, single-process mode)
		s.store.Append(writeCtx, e)
	}

	// 2. Fan out to subscribers
	s.subMu.RLock()
	defer s.subMu.RUnlock()
	for sub := range s.subs {
		// Non-blocking send with metric
		select {
		case sub.Ch <- e:
			// delivered
		default:
			// subscriber too slow — track it
			atomic.AddUint64(&sub.dropped, 1)
			if s.onSlowSubscriber != nil {
				s.onSlowSubscriber(sub, e)
			}
		}
	}
}

// Sub represents a single subscriber. Tracks its own drop count so
// different subscribers can have different health.
type Sub struct {
	id      string
	Ch      chan Event
	dropped uint64 // atomic
	closed  atomic.Bool
}

// Channel exposes the event channel for direct reading.
// Used by transport layers (SSE, websockets) that need a raw chan.
func (s *Sub) Channel() <-chan Event { return s.Ch }

func (s *Sub) Dropped() uint64 { return atomic.LoadUint64(&s.dropped) }
func (s *Sub) ID() string      { return s.id }

func (s *Session) subscribe(id string) *Sub {
	sub := &Sub{
		id: id,
		Ch: make(chan Event, 256), // larger buffer than before
	}
	s.subMu.Lock()
	s.subs[sub] = struct{}{}
	s.subMu.Unlock()
	return sub
}

func (s *Session) unsubscribe(sub *Sub) {
	s.subMu.Lock()
	delete(s.subs, sub)
	s.subMu.Unlock()
	sub.closed.Store(true)
	close(sub.Ch)
}

// Stream returns a channel that delivers events for this session.
// The channel is closed when the session ends or the caller unsubscribes.
// The returned *Sub lets the caller track its drop count.
func (s *Session) Stream(id string) *Sub {
	return s.subscribe(id)
}

// StopStream unsubscribes and closes the channel.
func (s *Session) StopStream(sub *Sub) {
	s.unsubscribe(sub)
}
