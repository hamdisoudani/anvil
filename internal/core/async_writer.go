package core

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// AsyncEventWriter buffers event writes to a background goroutine.
// The hot path (emit) enqueues an event and returns immediately —
// no blocking on Postgres round-trip.
//
// Trade-off: events are persisted asynchronously, so a crash between
// emit and the write completing loses the unsent events. To compensate:
//   - The loop also calls checkpoint() every N steps (synchronous)
//   - The event log is the audit log, not the source of truth for state
//   - State is recoverable from the last checkpoint
//
// For a fully durable hot path, switch the implementation to a
// syncronous one (each emit blocks). The interface stays the same.
type AsyncEventWriter struct {
	store   EventStore
	in      chan Event
	done    chan struct{}
	dropped uint64 // atomic counter
	wg      sync.WaitGroup
}

// NewAsyncEventWriter starts a background writer. bufferSize controls
// how many events can be queued before emit starts dropping (and
// incrementing the dropped counter — never silently).
func NewAsyncEventWriter(store EventStore, bufferSize int) *AsyncEventWriter {
	if bufferSize <= 0 {
		bufferSize = 1024
	}
	w := &AsyncEventWriter{
		store: store,
		in:    make(chan Event, bufferSize),
		done:  make(chan struct{}),
	}
	w.wg.Add(1)
	go w.run()
	return w
}

func (w *AsyncEventWriter) run() {
	defer w.wg.Done()
	for {
		select {
		case <-w.done:
			// Drain remaining events on shutdown
			for {
				select {
				case e := <-w.in:
					w.writeOne(e)
				default:
					return
				}
			}
		case e := <-w.in:
			w.writeOne(e)
		}
	}
}

func (w *AsyncEventWriter) writeOne(e Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := w.store.Append(ctx, e); err != nil {
		atomic.AddUint64(&w.dropped, 1)
		log.Printf("anvil: event append failed: %v (total dropped: %d)", err, atomic.LoadUint64(&w.dropped))
	}
}

// Append enqueues an event. Non-blocking. Returns true if accepted,
// false if the buffer is full (caller can decide what to do).
func (w *AsyncEventWriter) Append(ctx context.Context, e Event) (int64, error) {
	// We don't get the assigned ID back synchronously anymore.
	// The ID is assigned by the store, but we need a placeholder.
	// The actual ID is set asynchronously in writeOne.
	select {
	case w.in <- e:
		// Return a sentinel; the engine never reads this back
		// because emit() doesn't depend on the ID.
		return 0, nil
	default:
		// Buffer full — drop and count
		atomic.AddUint64(&w.dropped, 1)
		return 0, errBufferFull
	}
}

// Dropped returns the count of events that couldn't be written.
func (w *AsyncEventWriter) Dropped() uint64 {
	return atomic.LoadUint64(&w.dropped)
}

// Close stops the writer, draining the buffer. Blocks until done.
func (w *AsyncEventWriter) Close() error {
	close(w.done)
	w.wg.Wait()
	return nil
}

var errBufferFull = &bufferFullError{}

type bufferFullError struct{}

func (e *bufferFullError) Error() string { return "event buffer full" }
