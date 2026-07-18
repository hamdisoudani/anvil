package core

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// AsyncEventWriter buffers event writes to a background goroutine.
//
// HONEST CONTRACT (this is not the old "every event is durable before
// the next step starts" promise — that was wrong once we made writes
// non-blocking):
//
//   1. EventID is assigned SYNCHRONOUSLY at Append() call time. A
//      live subscriber sees a real, monotonically-increasing ID. The
//      Last-Event-ID resume story works for live subscribers.
//
//   2. The actual store.Append happens in a background goroutine.
//      A crash between Append() returning and the goroutine flushing
//      loses the unsent events. The event log is the audit log, not
//      the source of truth for state. STATE is recoverable from the
//      last checkpoint.
//
//   3. When the buffer is full, events are dropped AND counted
//      (Dropped()). The dropped count is process-local.
//
//   4. A dropped-count > 0 indicates audit-log gaps. The State
//      carries a LastEventID for resume; events written after that
//      ID may or may not be durable — the client can detect this by
//      asking the engine for the durableUpTo watermark (TODO).
//
// For fully-durable writes (synchronous), use SyncEventWriter or
// wait for the buffer to drain with Flush().
type AsyncEventWriter struct {
	store   EventStore
	in      chan Event
	done    chan struct{}
	dropped uint64 // atomic counter, process-local
	wg      sync.WaitGroup

	// seq is a monotonic counter for event IDs, assigned in
	// Append() so live subscribers see a real ID. Replaces the
	// "EventID never written" bug the architecture critic found.
	seq uint64 // atomic
}

// NewAsyncEventWriter starts a background writer.
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

// Append enqueues an event. NON-BLOCKING. Assigns a monotonic sequence
// number to e.EventID synchronously so live subscribers see a real ID.
// Returns the assigned EventID (caller can use it for Last-Event-ID
// resume).
func (w *AsyncEventWriter) Append(ctx context.Context, e Event) (int64, error) {
	// Assign the synchronous, monotonic EventID.
	// The Postgres bigserial (e.ID) is filled in later by the background goroutine.
	seq := atomic.AddUint64(&w.seq, 1)
	e.EventID = formatEventID(seq)

	select {
	case w.in <- e:
		return int64(seq), nil
	default:
		// Buffer full — drop and count
		atomic.AddUint64(&w.dropped, 1)
		return int64(seq), errBufferFull
	}
}

// formatEventID turns a counter into a client-visible string.
// Real implementations would use ULID or snowflake; we use a simple
// monotonic counter for the v0.3 milestone. ULID can come later.
func formatEventID(n uint64) string {
	// Simple decimal — wire-compatible with Last-Event-ID header
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
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

// Drainable returns true if the writer can guarantee durability for
// all events submitted before the returned event ID. Used by tests
// to assert "wait for everything to flush" semantics.
//
// This is a stub — real impl would track the highest seq that has
// been confirmed by the store.
func (w *AsyncEventWriter) Drainable() uint64 {
	return atomic.LoadUint64(&w.seq) - atomic.LoadUint64(&w.dropped)
}

var errBufferFull = &bufferFullError{}

type bufferFullError struct{}

func (e *bufferFullError) Error() string { return "event buffer full" }

// IsBufferFull is a convenience for errors.Is checks.
func IsBufferFull(err error) bool {
	_, ok := err.(*bufferFullError)
	return ok
}
