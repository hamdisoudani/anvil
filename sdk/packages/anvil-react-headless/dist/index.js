"use client";
import { jsx as _jsx } from "react/jsx-runtime";
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
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, } from "react";
import { AnvilClient, reduceAgentStateFromEvents as canonicalReduceAgentStateFromEvents, } from "@anvil/client";
// Pure reducers (framework-agnostic, escape hatch for domain logic).
// NOTE: reduceAgentState / reduceAgentStateFromEvents / reduceEventsToMessages
// are also defined locally in this file (kept as the canonical React-side
// version). The exports below add the custom-reducer registry + thread
// hydration reducers that don't have local equivalents.
export { agentStateFromTurns, messagesFromTurns, threadToEvents, registerReducer, listCustomReducers, } from "@anvil/client";
export { canonicalReduceAgentStateFromEvents };
// ── Initial state ─────────────────────────────────────────────────
const INITIAL_AGENT_STATE = {
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
export function reduceAgentState(state, event) {
    // Unknown events: silently drop. The server shouldn't be sending
    // them, but if a future schema upgrade races a deploy, we don't
    // crash.
    if ("_unknown" in event)
        return state;
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
            const plan = event.payload.plan;
            return { ...state, plan };
        }
        case "plan.step": {
            // A step transitioned. Update existing step with same id, or
            // append.
            const step = {
                id: event.payload.step.id,
                intent: event.payload.step.intent,
                status: event.payload.step.status,
                detail: event.payload.step.detail,
                tool: event.payload.step.tool,
                index: event.payload.step.index,
            };
            const existingIdx = state.planSteps.findIndex((s) => s.id === step.id);
            const planSteps = existingIdx >= 0
                ? state.planSteps.map((s, i) => (i === existingIdx ? { ...s, ...step } : s))
                : [...state.planSteps, step];
            const currentStepIndex = existingIdx >= 0 ? existingIdx : planSteps.length - 1;
            // Derive phase from the currently running step.
            const runningStep = planSteps.find((s) => s.status === "running");
            let phase = state.phase;
            if (runningStep) {
                const intent = runningStep.intent.toLowerCase();
                const tool = (runningStep.tool ?? "").toLowerCase();
                if (tool === "search" || /search|find|browse/.test(intent)) {
                    phase = "searching";
                }
                else if (tool === "fetch_page" ||
                    /read|extract|scrape|parse/.test(intent)) {
                    phase = "reading";
                }
                else if (/plan/.test(intent)) {
                    phase = "planning";
                }
                else if (/synthesize|write|generate/.test(intent)) {
                    phase = "writing";
                }
            }
            const searchesDone = planSteps.filter((s) => s.status === "done" && /search|find|browse/i.test(s.intent)).length;
            const pagesRead = planSteps.filter((s) => s.status === "done" && /read|extract|scrape|parse/i.test(s.intent)).length;
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
            const newSources = event.payload.sources.filter((s) => !existingUrls.has(s.url));
            if (newSources.length === 0)
                return state;
            return { ...state, sources: [...state.sources, ...newSources] };
        }
        case "frontend.call": {
            // Some deployments deliver the plan via frontend.call
            // (legacy). Map to AgentPlan. The wire payload is `unknown`
            // (legacy compatibility); we explicitly assert shape and
            // ensure `subQueries` is at least `[]` to match AgentPlan.
            const fc = event.payload;
            if (fc.name === "show_plan_step" && fc.input) {
                const input = fc.input;
                const plan = {
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
                currentReasoning: (state.currentReasoning ?? "") + event.payload.delta,
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
            const error = {
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
            const _exhaustive = event;
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
export function reduceAgentStateFromEvents(events) {
    let state = INITIAL_AGENT_STATE;
    for (const e of events) {
        state = reduceAgentState(state, e);
    }
    return state;
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
export function useAgentState(options) {
    const hasExternalEvents = options?.sharedEvents !== undefined;
    const sessionId = options?.sessionId ?? null;
    const { client } = useAnvil(); // Requires <AnvilProvider> (same as all other hooks)
    const [internalEvents, setInternalEvents] = useState([]);
    const prevSessionRef = useRef(null);
    // Subscribe to the session stream when sessionId changes
    // (only used when no sharedEvents are provided).
    useEffect(() => {
        if (hasExternalEvents || !sessionId)
            return;
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
const AnvilContext = createContext(null);
export function AnvilProvider(props) {
    const { baseUrl, client: providedClient, config, children } = props;
    const client = useMemo(() => {
        if (providedClient)
            return providedClient;
        return new AnvilClient({ baseUrl, ...config });
    }, [providedClient, baseUrl, config]);
    const toolsRef = useRef(new Map());
    const registerTool = useCallback((tool) => {
        toolsRef.current.set(tool.name, tool);
        return () => {
            toolsRef.current.delete(tool.name);
        };
    }, []);
    const getTool = useCallback((name) => {
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
    const value = { client, registerTool, getTool };
    return _jsx(AnvilContext.Provider, { value: value, children: children });
}
export function useAnvil() {
    const v = useContext(AnvilContext);
    if (!v)
        throw new Error("useAnvil must be used inside <AnvilProvider>");
    return v;
}
export function useSession(opts = {}) {
    const { client, getTool } = useAnvil();
    const [sessionId, setSessionId] = useState(opts.sessionId ?? null);
    const [status, setStatus] = useState("idle");
    const [error, setError] = useState(null);
    const [eventCount, setEventCount] = useState(0);
    const [lastEventId, setLastEventId] = useState(0);
    const subRef = useRef(null);
    const sessionRef = useRef(null); // track current session for dedup
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
    const subscribe = useCallback((id) => {
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
            console.log("[ANVIL-DEBUG] event type=" + e.type + " payload=" + JSON.stringify(e.payload || {}).substring(0, 200));
            // Persist to a window global so the test harness can inspect.
            if (typeof window !== "undefined") {
                const w = window;
                (w.__anvilDebug ||= []).push({ type: e.type, payload: e.payload });
            }
            // Handle tool calls — either via onToolCall or the registry
            if (e.type === "tool.call") {
                const p = e.payload;
                console.log("[ANVIL-DEBUG] tool.call event:", JSON.stringify(p));
                if (p.is_frontend) {
                    // Map server's "id" → callId and preserve is_frontend so
                    // useAgent can open a PendingInterrupt (HITL) when no local
                    // tool handler is registered.
                    const call = {
                        callId: p.id,
                        name: p.name,
                        input: p.input,
                        isFrontend: true,
                    };
                    // Find executor
                    const tool = getTool(p.name);
                    const exec = onToolCallRef.current
                        ? () => onToolCallRef.current(call)
                        : tool
                            ? () => tool.execute(p.input)
                            : null;
                    if (exec) {
                        try {
                            const result = await Promise.resolve(exec());
                            await client.deliverToolResult(id, p.id, result);
                        }
                        catch (err) {
                            await client.deliverToolResult(id, p.id, null, err instanceof Error ? err.message : String(err));
                        }
                    }
                    else {
                        // No handler — report as error so the agent doesn't hang
                        await client.deliverToolResult(id, p.id, null, `no handler registered for frontend tool "${p.name}"`);
                    }
                }
            }
            if (e.type === "done")
                setStatus("done");
            if (e.type === "paused")
                setStatus("paused");
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
    const start = useCallback(async (task, opts) => {
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
        }
        catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setStatus("error");
            throw err;
        }
    }, [client, subscribe]);
    const resume = useCallback(async (id) => {
        setStatus("starting");
        setError(null);
        try {
            const { sessionId: newId } = await client.resume(id);
            setSessionId(newId);
            subscribe(newId);
            return newId;
        }
        catch (err) {
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
export function useEvents(sessionId) {
    const { client } = useAnvil();
    const [events, setEvents] = useState([]);
    const subRef = useRef(null);
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
export function useAnvilEvent(sessionId, type, handler) {
    const { client } = useAnvil();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;
    useEffect(() => {
        if (!sessionId)
            return undefined;
        const sub = client.subscribe(sessionId, (e) => {
            if (e.type === type) {
                handlerRef.current(e);
            }
        });
        return () => sub.unsubscribe();
    }, [sessionId, type, client]);
}
// ── useFrontendTool: declare a browser-side tool ─────────────────
export function useFrontendTool(tool) {
    const { registerTool } = useAnvil();
    // Keep latest tool implementation without re-registering on every render
    const toolRef = useRef(tool);
    toolRef.current = tool;
    // Register once per name; re-register only if name changes
    useEffect(() => {
        const wrapper = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: (input) => toolRef.current.execute(input),
        };
        return registerTool(wrapper);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerTool, tool.name]);
}
export function useChat(sessionId, events) {
    const { events: ownEvents } = useEvents(sessionId);
    const allEvents = events ?? ownEvents;
    const messages = useMemo(() => {
        const out = [];
        let currentAssistant = null;
        let subAgents = new Map();
        let pendingSources = null;
        for (const e of allEvents) {
            switch (e.type) {
                case "session.start": {
                    // New turn in this thread — clear per-turn transient state.
                    // Cumulative chat messages (out[]) are PRESERVED so multi-turn
                    // history stays visible. Only `currentAssistant` (which is
                    // already null after a prior `done`) and `pendingSources` reset.
                    pendingSources = null;
                    // The user message is the task itself; emit it once per turn.
                    const task = e.payload?.task;
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
                    const delta = e.payload.delta;
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
                    const p = e.payload;
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
                    const p = e.payload;
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
                    const p = e.payload;
                    if (p.action === "start") {
                        const msg = {
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
                    const p = e.payload;
                    const sources = p.sources;
                    if (currentAssistant) {
                        // Attach to the current assistant message
                        const idx = out.indexOf(currentAssistant);
                        if (idx >= 0) {
                            currentAssistant = { ...currentAssistant, sources };
                            out[idx] = currentAssistant;
                        }
                    }
                    else {
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
                    const p = e.payload;
                    if (p.name === "show_related" && p.input && p.input.questions) {
                        if (currentAssistant) {
                            const idx = out.indexOf(currentAssistant);
                            if (idx >= 0) {
                                const updated = { ...out[idx], related: p.input.questions };
                                out[idx] = updated;
                                currentAssistant = updated;
                            }
                        }
                    }
                    break;
                }
                case "done": {
                    const p = e.payload;
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
// ── Shell (pluggable storage + routing) ────────────────────────────
export { AnvilShell, useAnvilShell, useAnvilShellOptional, } from "./shell";
// ── Agent context (share an agent across components) ────────────────
export { AgentProvider, useAgentContext, useAgentContextOptional, } from "./agent-context";
// ── Checkpoint (persist + resume agent state) ───────────────────────
export { CheckpointProvider, useCheckpoint, useCheckpointOptional, } from "./checkpoint";
//# sourceMappingURL=index.js.map