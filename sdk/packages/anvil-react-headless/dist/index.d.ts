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
import { type ReactNode } from "react";
import { AnvilClient, type AnvilEvent, type AnyAnvilEvent, type EventType, type Subscription, type ClientConfig, type AgentPhase as AgentPhaseClient, type AgentSource as AgentSourceClient, type PlanStep as PlanStepClient, type PlanObject as PlanObjectClient, type PlanSubQuery as PlanSubQueryClient, type AgentState as AgentStateClient, reduceAgentStateFromEvents as canonicalReduceAgentStateFromEvents } from "@anvil/client";
export type { AnvilEvent, AnyAnvilEvent, EventType, Subscription, ClientConfig, };
export { canonicalReduceAgentStateFromEvents };
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
export declare function reduceAgentState(state: AgentState, event: AnyAnvilEvent): AgentState;
/**
 * Reduce an array of AnvilEvents into a single AgentState.
 *
 * @param events  Ordered array of events (oldest first).
 * @returns       Final AgentState after processing all events.
 */
export declare function reduceAgentStateFromEvents(events: AnyAnvilEvent[]): AgentState;
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
export declare function useAgentState(options?: UseAgentStateOptions): AgentState;
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
    registerTool: <TInput = unknown, TOutput = unknown>(tool: FrontendToolExecutor<TInput, TOutput>) => () => void;
    /** Get a registered tool by name. */
    getTool: (name: string) => FrontendToolExecutor | undefined;
}
export interface AnvilProviderProps {
    /** Base URL of the Anvil HTTP server. */
    baseUrl: string;
    /** Advanced: provide your own client. */
    client?: AnvilClient;
    /** Advanced: full ClientConfig override. */
    config?: Partial<ClientConfig>;
    children: ReactNode;
}
export declare function AnvilProvider(props: AnvilProviderProps): import("react").JSX.Element;
export declare function useAnvil(): AnvilContextValue;
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
    start: (task: string, opts?: {
        threadId?: string;
        focus?: string;
    }) => Promise<{
        sessionId: string;
        threadId: string;
    }>;
    /** Resume a paused session. */
    resume: (sessionId: string) => Promise<string>;
    /** Cancel the current session (server-side stop + close subscription). */
    cancel: () => void;
    /** Number of events received. */
    eventCount: number;
    /** Last event id seen. */
    lastEventId: number;
}
export declare function useSession(opts?: UseSessionOptions): UseSessionResult;
export declare function useEvents(sessionId: string | null): {
    events: AnyAnvilEvent[];
    clear: () => void;
    lastId: number;
};
export declare function useAnvilEvent<T extends EventType>(sessionId: string | null, type: T, handler: (e: Extract<AnvilEvent, {
    type: T;
}>) => void): void;
export declare function useFrontendTool<TInput = unknown, TOutput = unknown>(tool: FrontendToolExecutor<TInput, TOutput>): void;
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
    sources?: Array<{
        id: number;
        url: string;
        title: string;
        domain: string;
    }>;
    /** Related questions from the agent (populated from show_related) */
    related?: string[];
}
export declare function useChat(sessionId: string | null, events?: AnyAnvilEvent[]): {
    messages: ChatMessage[];
};
export { useAgent } from "./useAgent";
export type { ToolHandler, ToolDefinition, ToolRenderer, UseAgentOptions, UseAgentReturn, PendingInterrupt } from "./useAgent";
//# sourceMappingURL=index.d.ts.map