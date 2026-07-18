package core

import (
	"context"
	"log"
	"os"
	"sync/atomic"
)

// Logger is the structured logging interface for the engine.
// Implementations: stderr (default), JSON-to-stdout, OTel, noop.
//
// Logs are best-effort. A slow logger must not block the agent loop.
type Logger interface {
	Debug(msg string, fields map[string]interface{})
	Info(msg string, fields map[string]interface{})
	Warn(msg string, fields map[string]interface{})
	Error(msg string, fields map[string]interface{})
}

// StderrLogger writes to stderr. Default if no logger is set.
type StderrLogger struct {
	debugEnabled atomic.Bool
}

func NewStderrLogger() *StderrLogger {
	l := &StderrLogger{}
	l.debugEnabled.Store(false)
	return l
}

func (l *StderrLogger) Debug(msg string, fields map[string]interface{}) {
	if l.debugEnabled.Load() {
		l.log("DEBUG", msg, fields)
	}
}
func (l *StderrLogger) Info(msg string, fields map[string]interface{}) {
	l.log("INFO", msg, fields)
}
func (l *StderrLogger) Warn(msg string, fields map[string]interface{}) {
	l.log("WARN", msg, fields)
}
func (l *StderrLogger) Error(msg string, fields map[string]interface{}) {
	l.log("ERROR", msg, fields)
}

// EnableDebug turns on debug-level logs.
func (l *StderrLogger) EnableDebug() { l.debugEnabled.Store(true) }

func (l *StderrLogger) log(level, msg string, fields map[string]interface{}) {
	// Simple key=value format, no JSON to keep the log readable
	out := "[" + level + "] " + msg
	for k, v := range fields {
		out += " " + k + "=" + stringify(v)
	}
	log.New(os.Stderr, "", log.LstdFlags).Println(out)
}

func stringify(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case error:
		return t.Error()
	default:
		return ""
	}
}

// NoopLogger discards everything.
type NoopLogger struct{}

func (NoopLogger) Debug(string, map[string]interface{}) {}
func (NoopLogger) Info(string, map[string]interface{})  {}
func (NoopLogger) Warn(string, map[string]interface{})  {}
func (NoopLogger) Error(string, map[string]interface{}) {}

// WithLogger attaches a logger to a session.
func (s *Session) WithLogger(l Logger) *Session {
	s.logger = l
	return s
}

// log is the internal convenience method.
func (s *Session) log(level, msg string, fields map[string]interface{}) {
	if s.logger == nil {
		return
	}
	switch level {
	case "debug":
		s.logger.Debug(msg, fields)
	case "info":
		s.logger.Info(msg, fields)
	case "warn":
		s.logger.Warn(msg, fields)
	case "error":
		s.logger.Error(msg, fields)
	}
}

// Ensure context import is used
var _ = context.Background
