"use client";

/**
 * @anvil/react-headless — React hooks for Anvil.
 *
 * Provides:
 *   - AnvilProvider: configures the client + holds frontend tool registry
 *   - useAnvil(): access the client and tool registry
 *   - useSession(): start/manage a session, returns live events
 *   - useEvents(): subscribe to a session, returns event list + last id
 *   - useChat(): the high-level chat-style hook (events → messages)
 *   - useFrontendTool(): declare a tool the agent can call in the browser
 *   - useAnvilEvent(): subscribe to a specific event type
 *   - useAgentState(): real-time agent thinking state machine
 *   - reduceAgentState() / reduceAgentStateFromEvents(): pure reducers
 *
 * Designed to be UI-agnostic. Bring your own components.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  AnvilClient,
  type AnvilEvent,
  type AnyAnvilEvent,
  type EventType,
  type Subscription,
  type ClientConfig,
  type ErrorPayload,
  type AgentPhase as AgentPhaseClient,
  type AgentSource as AgentSourceClient,
  type PlanStep as PlanStepClient,
  type PlanObject as PlanObjectClient,
  type PlanSubQuery as PlanSubQueryClient,
  type AgentState as AgentStateClient,
  reduceAgentState as canonicalReduceAgentState,
  reduceAgentStateFromEvents as canonicalReduceAgentStateFromEvents,
} from "@anvil/client";

import { INITIAL_AGENT_STATE as INITIAL_AGENT_STATE_CLIENT } from "@anvil/client";

// Re-export types consumers need
export type {
  AnvilEvent,
  AnyAnvilEvent,
  EventType,
  Subscription,
  ClientConfig,
};
export { canonicalReduceAgentStateFromEvents };

// ── Agent Error Type ──────────────────────────────────────────

// ── Agent State (UI-facing view-model) ──────────────────────────

/**
 * Structured error from the agent, emitted via the 'error' event.
 * Provides severity levels, recoverability hints, and optional
 * raw payload for debugging.
 */
export type AgentError = {
  message: string;
  code?: string;
  severity?: "info" | "warning" | "error" | "fatal";
  recoverable?: boolean;
  retryable?: boolean;
  stepId?: string;
  raw?: unknown;
};

/**
 * High-level phase of the agent's thinking loop.
 * Re-exported from `@anvil/client` so callers get the same
 * string literal union everywhere.
 */
export type AgentPhase = AgentPhaseClient;

/** A single step in the agent's plan timeline. */
export type PlanStep = PlanStepClient;

/** A source discovered and used by the agent. */
export type AgentSource = AgentSourceClient;

/** A decomposed sub-query within the agent's search plan. */
export type PlanSubQuery = PlanSubQueryClient;

/** The plan object delivered via the show_plan_step frontend call. */
export type AgentPlan = PlanObjectClient;

/**
 * Full reactive agent state exposed by useAgentState.
 *
 * Extends the canonical wire AgentState (in @anvil/client) by
 * adding the structured `error: AgentError | null` field. The
 * wire `error: ErrorPayload | null` is normalized to `AgentError`
 * so React components have a stable shape to render.
 */
export interface AgentState extends AgentStateClient {
  error: AgentError | null;
}

// ── Initial state ─────────────────────────────────────────────────

const INITIAL_AGENT_STATE: AgentState = {
  phase: "idle",
  task: null,
  sessionId: null,
  threadId: null,
  planSteps: [],
  plan: null,
  sources: [],
  searchesDone: 0,
  pagesRead: 0,
  currentStepIndex: -1,
  currentReasoning: "",
  currentAnswer: "",
  isStreaming: false,
  doneReceived: false,
  error: null,
};

// ── Pure reducers (framework-agnostic data layer) ─────────────────

/**
 * Process a single Anvil event through the agent state reducer.
 *
 * This is a **pure function** — no React, no side-effects. You can import
 * it to build the same state machine in Vue, Svelte, vanilla JS, or
 * server-side renderers.
 *
 * @param state  The current AgentState (start with INITIAL_AGENT_STATE).
 * @param event  A single AnvilEvent from the session stream.
 * @returns      The next AgentState.
 */
export function reduceAgentState(
  state: AgentState,
  event: AnyAnvilEvent,
): AgentState {
  // Unknown events: silently drop. The server shouldn't be sending
  // them, but if a future schema upgrade races a deploy, we don't
  // crash.
  if ("_unknown" in event) return state;

  // Dispatch on the discriminated union. TypeScript narrows
  // `event.payload` to the typed payload for each branch — no
  // casts, no `as any`, no `Record<string, unknown>`.
  switch (event.type) {
    case "session.start": {
      return {
        ...INITIAL_AGENT_STATE,
        phase: "planning",
        task: event.payload.task,
        sessionId: event.sessionId,
        threadId: event.payload.threadId,
      };
    }

    case "plan.set": {
      // The canonical `plan.set` event delivers the full plan
      // object. Replace any prior plan.
      const plan: AgentPlan = event.payload.plan;
      return { ...state, plan };
    }

    case "plan.step": {
      // A step transitioned. Update existing step with same id, or
      // append.
      const step: PlanStep = {
        id: event.payload.step.id,
        intent: event.payload.step.intent,
        status: event.payload.step.status,
        detail: event.payload.step.detail,
        tool: event.payload.step.tool,
        index: event.payload.step.index,
      };

      const existingIdx = state.planSteps.findIndex((s) => s.id === step.id);
      const planSteps =
        existingIdx >= 0
          ? state.planSteps.map((s, i) => (i === existingIdx ? { ...s, ...step } : s))
          : [...state.planSteps, step];

      const currentStepIndex =
        existingIdx >= 0 ? existingIdx : planSteps.length - 1;

      // Derive phase from the currently running step.
      const runningStep = planSteps.find((s) => s.status === "running");
      let phase: AgentPhase = state.phase;

      if (runningStep) {
        const intent = runningStep.intent.toLowerCase();
        const tool = (runningStep.tool ?? "").toLowerCase();
        if (tool === "search" || /search|find|browse/.test(intent)) {
          phase = "searching";
        } else if (
          tool === "fetch_page" ||
          /read|extract|scrape|parse/.test(intent)
        ) {
          phase = "reading";
        } else if (/plan/.test(intent)) {
          phase = "planning";
        } else if (/synthesize|write|generate/.test(intent)) {
          phase = "writing";
        }
      }

      const searchesDone = planSteps.filter(
        (s) => s.status === "done" && /search|find|browse/i.test(s.intent),
      ).length;
      const pagesRead = planSteps.filter(
        (s) =>
          s.status === "done" && /read|extract|scrape|parse/i.test(s.intent),
      ).length;

      return {
        ...state,
        planSteps,
        currentStepIndex,
        phase,
        searchesDone,
        pagesRead,
      };
    }

    case "sources.found": {
      // New sources — dedup by URL.
      const existingUrls = new Set(state.sources.map((s) => s.url));
      const newSources = event.payload.sources.filter(
        (s) => !existingUrls.has(s.url),
      );
      if (newSources.length === 0) return state;
      return { ...state, sources: [...state.sources, ...newSources] };
    }

    case "frontend.call": {
      // Some deployments deliver the plan via frontend.call
      // (legacy). Map to AgentPlan. The wire payload is `unknown`
      // (legacy compatibility); we explicitly assert shape and
      // ensure `subQueries` is at least `[]` to match AgentPlan.
      const fc = event.payload;
      if (fc.name === "show_plan_step" && fc.input) {
        const input = fc.input as {
          reason?: string;
          synthesizeHint?: string;
          needsSearch?: boolean;
          subQueries?: { id: string; query: string; intent: string }[];
          [key: string]: unknown;
        };
        const plan: AgentPlan = {
          reason: input.reason,
          synthesizeHint: input.synthesizeHint,
          needsSearch: input.needsSearch,
          subQueries: input.subQueries ?? [],
          ...input,
        };
        return { ...state, plan };
      }
      return state;
    }

    case "think.chunk": {
      // Internal monologue. Stored separately from answer text so
      // reasoning UIs can render it without polluting the final
      // answer.
      return {
        ...state,
        isStreaming: true,
        currentReasoning:
          (state.currentReasoning ?? "") + event.payload.delta,
      };
    }

    case "answer.chunk": {
      return {
        ...state,
        phase: "writing",
        isStreaming: true,
        currentAnswer: state.currentAnswer + event.payload.delta,
      };
    }

    case "done": {
      return {
        ...state,
        phase: "done",
        doneReceived: true,
        isStreaming: false,
        // Done payload may carry the final answer if chunks were
        // dropped from the buffer.
        currentAnswer: event.payload.answer ?? state.currentAnswer,
      };
    }

    case "paused": {
      return { ...state, isStreaming: false };
    }

    case "error": {
      // Wire-level error becomes the UI-facing AgentError shape.
      // `raw` carries the full payload for debugging.
      const p = event.payload;
      const error: AgentError = {
        message: p.message,
        code: p.code,
        severity: p.severity,
        recoverable: p.recoverable,
        retryable: p.retryable,
        stepId: p.step_id,
        raw: p,
      };
      return {
        ...state,
        phase: p.recoverable ? state.phase : "error",
        error,
        isStreaming: false,
      };
    }

    case "tool.call":
    case "tool.result":
    case "subagent.start":
    case "subagent.end":
    case "answer.end":
    case "think.start":
    case "think.end":
    case "anvil.dropped":
    case "checkpoint":
    case "ready":
      // Currently informational. Hook into them in a future
      // iteration; for now the UI doesn't need them.
      return state;

    default: {
      // Exhaustiveness check: if a new event type is added to the
      // schema, this assignment fails to compile until handled.
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Reduce an array of AnvilEvents into a single AgentState.
 *
 * @param events  Ordered array of events (oldest first).
 * @returns       Final AgentState after processing all events.
 */
export function reduceAgentStateFromEvents(
  events: AnyAnvilEvent[],
): AgentState {
  let state: AgentState = INITIAL_AGENT_STATE;
  for (const e of events) {
    state = reduceAgentState(state, e);
  }
  return state;
}

// ── useAgentState: React hook ────────────────────────────────────

export interface UseAgentStateOptions {
  /**
   * Session ID to subscribe to. Ignored when `sharedEvents` is provided.
   * Requires being inside <AnvilProvider>.
   */
  sessionId?: string | null;
  /**
   * Shared event array (single-source-of-truth pattern, same as
   * AnvilPerplexity uses). When provided, the hook reads from this
   * array instead of opening its own subscription. This is the
   * recomended mode for composability — share one event stream
   * across multiple hooks (useChat, useAgentState, etc.).
   */
  sharedEvents?: AnyAnvilEvent[];
}

/**
 * Subscribe to an Anvil session's raw events and derive a high-level
 * `AgentState` that tracks the agent's thinking process in real time.
 *
 * Two modes:
 *
 * **sharedEvents mode** (recommended for composability):
 * ```tsx
 * const [sharedEvents, setSharedEvents] = useState<AnyAnvilEvent[]>([]);
 * const session = useSession({
 *   onEvent: (e) => setSharedEvents(prev => [...prev, e]),
 * });
 * const { messages } = useChat(session.sessionId, sharedEvents);
 * const agentState = useAgentState({ sharedEvents });
 * ```
 *
 * **sessionId mode** (convenience — subscribes internally):
 * ```tsx
 * const agentState = useAgentState({ sessionId });
 * ```
 *
 * The `agentState` re-renders on every event, making it suitable for
 * real-time UIs that show spinners, step indicators, progress bars,
 * and streaming answer text.
 */
export function useAgentState(
  options?: UseAgentStateOptions,
): AgentState {
  const hasExternalEvents = options?.sharedEvents !== undefined;
  const sessionId = options?.sessionId ?? null;

  const { client } = useAnvil(); // Requires <AnvilProvider> (same as all other hooks)
  const [internalEvents, setInternalEvents] = useState<AnyAnvilEvent[]>([]);
  const prevSessionRef = useRef<string | null>(null);

  // Subscribe to the session stream when sessionId changes
  // (only used when no sharedEvents are provided).
  useEffect(() => {
    if (hasExternalEvents || !sessionId) return;

    // Reset event log when switching sessions
    if (prevSessionRef.current !== sessionId) {
      setInternalEvents([]);
      prevSessionRef.current = sessionId;
    }

    const sub = client.subscribe(sessionId, (e) => {
      setInternalEvents((prev) => [...prev, e]);
    });
    return () => {
      sub.unsubscribe();
    };
  }, [sessionId, hasExternalEvents, client]);

  // Pick the event source — external takes priority
  const events = hasExternalEvents
    ? (options?.sharedEvents ?? [])
    : internalEvents;

  // Derive AgentState via the pure reducer on every render.
  // useMemo ensures referential stability only when the event
  // list actually changes.
  const state = useMemo(() => reduceAgentStateFromEvents(events), [events]);

  return state;
}

// ── Context ───────────────────────────────────────────────────────

export interface FrontendToolExecutor<TInput = unknown, TOutput = unknown> {
  /** Tool name (must match what the engine sees). */
  name: string;
  /** Human description shown to the LLM. */
  description: string;
  /** JSON schema for the input (object). */
  inputSchema: Record<string, unknown>;
  /** The browser-side function. */
  execute: (input: TInput) => Promise<TOutput> | TOutput;
}

export interface AnvilContextValue {
  client: AnvilClient;
  /** Register a frontend tool. Returns an unregister fn. */
  registerTool: <TInput = unknown, TOutput = unknown>(
    tool: FrontendToolExecutor<TInput, TOutput>,
  ) => () => void;
  /** Get a registered tool by name. */
  getTool: (name: string) => FrontendToolExecutor | undefined;
}

const AnvilContext = createContext<AnvilContextValue | null>(null);

export interface AnvilProviderProps {
  /** Base URL of the Anvil HTTP server. */
  baseUrl: string;
  /** Advanced: provide your own client. */
  client?: AnvilClient;
  /** Advanced: full ClientConfig override. */
  config?: Partial<ClientConfig>;
  children: ReactNode;
}

export function AnvilProvider(props: AnvilProviderProps) {
  const { baseUrl, client: providedClient, config, children } = props;

  const client = useMemo(() => {
    if (providedClient) return providedClient;
    return new AnvilClient({ baseUrl, ...config });
  }, [providedClient, baseUrl, config]);

  const toolsRef = useRef<Map<string, FrontendToolExecutor>>(new Map());

  const registerTool = useCallback(<TInput, TOutput>(tool: FrontendToolExecutor<TInput, TOutput>) => {
    toolsRef.current.set(tool.name, tool as FrontendToolExecutor);
    return () => {
      toolsRef.current.delete(tool.name);
    };
  }, []);

  const getTool = useCallback((name: string) => {
    return toolsRef.current.get(name);
  }, []);

  // Wire up tool result delivery: when a tool.call event arrives with
  // is_frontend=true, find the matching tool, execute it, deliver result.
  // The delivery is per-session, so we need to listen at the client level
  // — but actually that's the session subscriber's job (useSession
  // does it). Keep this provider just for tool registry.
  //
  // We do need a global listener for tool calls that need to be
  // answered even when the UI doesn't care. Use a background subscription.
  useEffect(() => {
    // No global handler needed — each useSession subscribes and
    // dispatches tool calls to its session's tool registry.
  }, []);

  const value: AnvilContextValue = { client, registerTool, getTool };

  return <AnvilContext.Provider value={value}>{children}</AnvilContext.Provider>;
}

export function useAnvil(): AnvilContextValue {
  const v = useContext(AnvilContext);
  if (!v) throw new Error("useAnvil must be used inside <AnvilProvider>");
  return v;
}

// ── useSession: manage a single session's lifecycle ───────────────

export interface UseSessionOptions {
  /** Resume this session on mount. */
  sessionId?: string;
  /** Called on every event. */
  onEvent?: (e: AnyAnvilEvent) => void;
  /** Called when a frontend tool call needs to be executed. */
  onToolCall?: (call: {
    callId: string;
    name: string;
    input: unknown;
    isFrontend?: boolean;
  }) => Promise<unknown> | unknown;
  /** Auto-reconnect on disconnect (default: true). */
  autoReconnect?: boolean;
}

export interface UseSessionResult {
  sessionId: string | null;
  status: "idle" | "starting" | "running" | "paused" | "done" | "error";
  error: Error | null;
  /**
   * Start a new agent task. If `opts.threadId` is provided, the new
   * session continues that thread (the server binds the new session
   * to the thread and the SDK appends the new session's events to
   * the existing shared event log, preserving prior chat history).
   *
   * Returns the new `sessionId` and the resolved `threadId`. If no
   * threadId was supplied, the server-generated one is returned.
   */
  start: (
    task: string,
    opts?: { threadId?: string; focus?: string },
  ) => Promise<{ sessionId: string; threadId: string }>;
  /** Resume a paused session. */
  resume: (sessionId: string) => Promise<string>;
  /** Cancel the current session (server-side stop + close subscription). */
  cancel: () => void;
  /** Number of events received. */
  eventCount: number;
  /** Last event id seen. */
  lastEventId: number;
}

export function useSession(opts: UseSessionOptions = {}): UseSessionResult {
  const { client, getTool } = useAnvil();
  const [sessionId, setSessionId] = useState<string | null>(opts.sessionId ?? null);
  const [status, setStatus] = useState<UseSessionResult["status"]>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [lastEventId, setLastEventId] = useState(0);
  const subRef = useRef<Subscription | null>(null);
  const sessionRef = useRef<string | null>(null); // track current session for dedup

  const onEventRef = useRef(opts.onEvent);
  const onToolCallRef = useRef(opts.onToolCall);
  onEventRef.current = opts.onEvent;
  onToolCallRef.current = opts.onToolCall;

  // Sync sessionId when opts.sessionId changes (e.g. URL hash change)
  useEffect(() => {
    if (opts.sessionId && opts.sessionId !== sessionId) {
      // Unsubscribe old session
      subRef.current?.unsubscribe();
      subRef.current = null;
      sessionRef.current = null;
      setSessionId(opts.sessionId);
      setStatus("starting");
      setEventCount(0);
      setLastEventId(0);
      onEventRef.current = opts.onEvent;
    }
  }, [opts.sessionId]);

  const subscribe = useCallback((id: string) => {
    // Guard: don't re-subscribe if already subscribed to THIS session
    if (sessionRef.current === id && subRef.current) {
      return;
    }
    sessionRef.current = id;
    subRef.current?.unsubscribe();
    setStatus("running");
    setEventCount(0);
    setLastEventId(0);
    subRef.current = client.subscribe(id, async (e) => {
      setEventCount((c) => c + 1);
      setLastEventId(e.eventId);
      onEventRef.current?.(e);

      // Handle tool calls — either via onToolCall or the registry
      if (e.type === "tool.call") {
        const p = e.payload as { id: string; name: string; input: unknown; is_frontend?: boolean };
        if (p.is_frontend) {
          // Map server's "id" → callId and preserve is_frontend so
          // useAgent can open a PendingInterrupt (HITL) when no local
          // tool handler is registered.
          const call = {
            callId: p.id,
            name: p.name,
            input: p.input,
            isFrontend: true as const,
          };
          // Find executor
          const tool = getTool(p.name);
          const exec = onToolCallRef.current
            ? () => onToolCallRef.current!(call)
            : tool
              ? () => tool.execute(p.input as any)
              : null;
          if (exec) {
            try {
              const result = await Promise.resolve(exec());
              await client.deliverToolResult(id, p.id, result);
            } catch (err) {
              await client.deliverToolResult(
                id,
                p.id,
                null,
                err instanceof Error ? err.message : String(err),
              );
            }
          } else {
            // No handler — report as error so the agent doesn't hang
            await client.deliverToolResult(
              id,
              p.id,
              null,
              `no handler registered for frontend tool "${p.name}"`,
            );
          }
        }
      }

      if (e.type === "done") setStatus("done");
      if (e.type === "paused") setStatus("paused");
    });
  }, [client, getTool]);

  // Subscribe when sessionId changes (either from start/resume or opts on mount)
  useEffect(() => {
    if (sessionId) {
      subscribe(sessionId);
      return () => {
        subRef.current?.unsubscribe();
        subRef.current = null;
      };
    }
    return undefined;
  }, [sessionId, subscribe]);
  // NOTE: This is the ONLY place subscribe() is called.
  // start() and resume() set sessionId; the effect subscribes.
  // This eliminates the double-subscription bug (BUG-H1).

  const start = useCallback(async (
    task: string,
    opts?: { threadId?: string; focus?: string },
  ) => {
    setStatus("starting");
    setError(null);
    try {
      const result = await client.startTask(task, opts);
      // Subscribe immediately AND set sessionId.
      // The sessionRef guard in subscribe() prevents the effect from
      // double-subscribing when sessionId changes.
      setSessionId(result.sessionId);
      subscribe(result.sessionId);
      return {
        sessionId: result.sessionId,
        threadId: result.threadId,
      };
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, [client, subscribe]);

  const resume = useCallback(async (id: string) => {
    setStatus("starting");
    setError(null);
    try {
      const { sessionId: newId } = await client.resume(id);
      setSessionId(newId);
      subscribe(newId);
      return newId;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, [client, subscribe]);

  const cancel = useCallback(() => {
    const id = sessionRef.current ?? sessionId;
    if (id) {
      void client.cancelSession(id);
    }
    subRef.current?.unsubscribe();
    subRef.current = null;
    sessionRef.current = null;
    setSessionId(null);
    setStatus("idle");
  }, [client, sessionId]);

  return { sessionId, status, error, start, resume, cancel, eventCount, lastEventId };
}

// ── useEvents: typed event log for a session ─────────────────────
//
// Returns the full event log for a session. Subscribes internally;
// for shared-events composition, use the overload below or pipe
// `useSession({ onEvent })` into a parent state.

export function useEvents(sessionId: string | null) {
  const { client } = useAnvil();
  const [events, setEvents] = useState<AnyAnvilEvent[]>([]);
  const subRef = useRef<Subscription | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      return undefined;
    }
    subRef.current = client.subscribe(sessionId, (e) => {
      setEvents((prev) => [...prev, e]);
    });
    return () => subRef.current?.unsubscribe();
  }, [sessionId, client]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, clear, lastId: events.at(-1)?.eventId ?? 0 };
}

// ── useAnvilEvent: subscribe to a specific event type ─────────────

export function useAnvilEvent<T extends EventType>(
  sessionId: string | null,
  type: T,
  handler: (e: Extract<AnvilEvent, { type: T }>) => void,
) {
  const { client } = useAnvil();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!sessionId) return undefined;
    const sub = client.subscribe(sessionId, (e) => {
      if (e.type === type) {
        handlerRef.current(e as Extract<AnvilEvent, { type: T }>);
      }
    });
    return () => sub.unsubscribe();
  }, [sessionId, type, client]);
}

// ── useFrontendTool: declare a browser-side tool ─────────────────

export function useFrontendTool<TInput = unknown, TOutput = unknown>(
  tool: FrontendToolExecutor<TInput, TOutput>,
) {
  const { registerTool } = useAnvil();
  // Keep latest tool implementation without re-registering on every render
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // Register once per name; re-register only if name changes
  useEffect(() => {
    const wrapper: FrontendToolExecutor<TInput, TOutput> = {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: (input) => toolRef.current.execute(input),
    };
    return registerTool(wrapper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerTool, tool.name]);
}

// ── useChat: high-level chat-style event reducer ─────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolError?: string;
  timestamp: number;
  isStreaming?: boolean;
  subAgentId?: string;
  subAgentRole?: string;
  /** Sources from the agent (populated from sources.found events) */
  sources?: Array<{ id: number; url: string; title: string; domain: string }>;
  /** Related questions from the agent (populated from show_related) */
  related?: string[];
}

export function useChat(sessionId: string | null, events?: AnyAnvilEvent[]) {
  const { events: ownEvents } = useEvents(sessionId);
  const allEvents = events ?? ownEvents;
  const messages = useMemo<ChatMessage[]>(() => {
    const out: ChatMessage[] = [];
    let currentAssistant: ChatMessage | null = null;
    let subAgents = new Map<string, ChatMessage>();
    let pendingSources: Array<{ id: number; url: string; title: string; domain: string }> | null = null;

    for (const e of allEvents) {
      switch (e.type) {
        case "session.start": {
          // New turn in this thread — clear per-turn transient state.
          // Cumulative chat messages (out[]) are PRESERVED so multi-turn
          // history stays visible. Only `currentAssistant` (which is
          // already null after a prior `done`) and `pendingSources` reset.
          pendingSources = null;
          // The user message is the task itself; emit it once per turn.
          const task = (e.payload as any)?.task as string | undefined;
          if (task) {
            out.push({
              id: `user-${e.eventId}`,
              role: "user",
              content: task,
              timestamp: Date.parse(e.createdAt),
            });
          }
          break;
        }
        case "answer.chunk":
        case "think.chunk": {
          const delta = (e.payload as any).delta as string;
          if (!currentAssistant) {
            currentAssistant = {
              id: `assistant-${e.eventId}`,
              role: "assistant",
              content: "",
              timestamp: Date.parse(e.createdAt),
              isStreaming: true,
              // Migrate pending sources if any
              sources: pendingSources ?? undefined,
            };
            out.push(currentAssistant);
            pendingSources = null;
          }
          currentAssistant.content += delta;
          // Keep currentAssistant synced with out[] so that
          // out.indexOf(currentAssistant) works on the next chunk.
          const idx = out.indexOf(currentAssistant);
          if (idx >= 0) {
            currentAssistant = { ...currentAssistant };
            out[idx] = currentAssistant;
          }
          break;
        }
        case "think.end": {
          if (currentAssistant) {
            currentAssistant.isStreaming = false;
            const idx = out.indexOf(currentAssistant);
            if (idx >= 0) {
              currentAssistant = { ...currentAssistant };
              out[idx] = currentAssistant;
            }
            currentAssistant = null;
          }
          break;
        }
        case "tool.call": {
          const p = e.payload as any;
          out.push({
            id: `tool-call-${e.eventId}`,
            role: "tool",
            content: p.name,
            toolName: p.name,
            toolInput: p.input,
            timestamp: Date.parse(e.createdAt),
          });
          break;
        }
        case "tool.result": {
          const p = e.payload as any;
          // Attach to last tool call
          for (let i = out.length - 1; i >= 0; i--) {
            const m = out[i];
            if (m && m.role === "tool" && m.toolName && !m.toolResult && !m.toolError) {
              out[i] = { ...m, toolResult: p.result, toolError: p.err };
              break;
            }
          }
          break;
        }
        case "subagent": {
          const p = e.payload as any;
          if (p.action === "start") {
            const msg: ChatMessage = {
              id: `sub-${p.sub_id}`,
              role: "assistant",
              content: `[${p.role}] ${p.task}`,
              timestamp: Date.parse(e.createdAt),
              subAgentId: p.sub_id,
              subAgentRole: p.role,
            };
            out.push(msg);
            subAgents.set(p.sub_id, msg);
          }
          break;
        }
        case "sources.found": {
          const p = e.payload as any;
          const sources = p.sources as Array<{ id: number; url: string; title: string; domain: string }>;
          if (currentAssistant) {
            // Attach to the current assistant message
            const idx = out.indexOf(currentAssistant);
            if (idx >= 0) {
              currentAssistant = { ...(currentAssistant as ChatMessage), sources };
              out[idx] = currentAssistant;
            }
          } else {
            // No assistant message yet — stash for later
            pendingSources = sources;
            // Also attach to the last user message as a fallback
            for (let i = out.length - 1; i >= 0; i--) {
              const m = out[i];
              if (m && m.role === "user") {
                out[i] = { ...m, sources };
                break;
              }
            }
          }
          break;
        }
        case "frontend.call": {
          // Attach the call's data to the current assistant message
          const p = e.payload as any;
          if (p.name === "show_related" && p.input && p.input.questions) {
            if (currentAssistant) {
              const idx = out.indexOf(currentAssistant);
              if (idx >= 0) {
                const updated: ChatMessage = { ...out[idx]!, related: p.input.questions };
                out[idx] = updated;
                currentAssistant = updated;
              }
            }
          }
          break;
        }
        case "done": {
          const p = e.payload as any;
          
          // Mark the last assistant message as done
          for (let i = out.length - 1; i >= 0; i--) {
            const m = out[i];
            if (m && m.role === "assistant") {
              out[i] = { 
                ...m, 
                isStreaming: false,
                sources: m.sources ?? p.sources ?? undefined, 
                related: m.related ?? p.related ?? undefined, 
              };
              break;
            }
          }
          
          if (currentAssistant) {
            currentAssistant.isStreaming = false;
            currentAssistant.sources = currentAssistant.sources ?? p.sources ?? undefined;
            currentAssistant.related = currentAssistant.related ?? p.related ?? undefined;
            const idx = out.indexOf(currentAssistant);
            if (idx >= 0) {
              currentAssistant = { ...currentAssistant };
              out[idx] = currentAssistant;
            }
            currentAssistant = null;
          }
          pendingSources = null;
          break;
        }
      }
    }
    return out;
  }, [allEvents]);

  return { messages };
}

// ── Unified Agent Hook ──────────────────────────────────────────
export { useAgent } from "./useAgent";
export type { ToolHandler, ToolDefinition, ToolRenderer, UseAgentOptions, UseAgentReturn, PendingInterrupt } from "./useAgent";
