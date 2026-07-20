package core

// Construction options for the Agent. Use these to assemble an Agent
// with the dependencies you want.

type AgentOption func(*Agent)

// New creates an Agent with the given options.
func New(opts ...AgentOption) *Agent {
	a := &Agent{
		cfg: DefaultConfig(),
	}
	for _, opt := range opts {
		opt(a)
	}
	return a
}

// WithEventStore sets the event store (Postgres, in-memory, etc).
func WithEventStore(s EventStore) AgentOption {
	return func(a *Agent) { a.store = s; if a.cp == nil { /* leave cp alone */ } }
}

// WithCheckpointStore sets the checkpoint store.
func WithCheckpointStore(s CheckpointStore) AgentOption {
	return func(a *Agent) { a.cp = s }
}

// WithCache sets the cache (Redis, in-memory, etc).
func WithCache(c Cache) AgentOption {
	return func(a *Agent) { a.cache = c }
}

// WithLLM sets the LLM router.
func WithLLM(r LLMRouter) AgentOption {
	return func(a *Agent) { a.router = r }
}

// WithTools sets the tool registry. Pass individual tools.
func WithTools(tools ...Tool) AgentOption {
	return func(a *Agent) {
		if a.tools == nil {
			a.tools = make(map[string]Tool)
		}
		for _, t := range tools {
			a.tools[t.Name()] = t
		}
	}
}

// WithToolMap sets the tool registry from a map. Convenience for
// users who already have a map of tools.
func WithToolMap(tools map[string]Tool) AgentOption {
	return func(a *Agent) {
		if a.tools == nil {
			a.tools = make(map[string]Tool)
		}
		for k, v := range tools {
			a.tools[k] = v
		}
	}
}

// WithRunRecordStore attaches a RunRecordStore. The engine writes
// one RunRecord per step, making anvil replay / inspect possible.
func WithRunRecordStore(s RunRecordStore) AgentOption {
	return func(a *Agent) { a.recordStore = s }
}

// WithConfig overrides the agent config.
func WithConfig(c Config) AgentOption {
	return func(a *Agent) { a.cfg = c }
}

// WithMiddleware attaches middleware to the agent execution path.
// Middleware is applied around LLM calls and tool executions.
func WithMiddleware(m ...Middleware) AgentOption {
	return func(a *Agent) { a.middleware = append(a.middleware, m...) }
}
