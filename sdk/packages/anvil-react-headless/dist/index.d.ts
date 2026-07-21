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
import { AnvilClient, type AnvilEvent, type EventType, type Subscription, type ClientConfig } from "@anvil/client";
export type { AnvilEvent, EventType, Subscription, ClientConfig };
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
 * Used by UIs to render appropriate indicators (spinners, progress bars, etc.).
 */
export type AgentPhase = "idle" | "planning" | "searching" | "reading" | "writing" | "done" | "error";
/**
 * A single step in the agent's plan timeline.
 * Emitted as plan.step events from the server.
 */
export interface PlanStep {
    id: string;
    intent: string;
    status: "pending" | "running" | "done" | "error";
    detail?: string;
}
/**
 * A source discovered and used by the agent.
 */
export interface AgentSource {
    id: number;
    url: string;
    title: string;
    domain: string;
}
/**
 * A decomposed sub-query within the agent's search plan.
 */
export interface PlanSubQuery {
    id: string;
    intent: string;
    query: string;
    source?: string;
    year?: number;
    fetch_top?: number;
    depends_on?: string[];
}
/**
 * The plan object delivered via the show_plan_step frontend call.
 */
export interface AgentPlan {
    reason?: string;
    needs_search?: boolean;
    synthesize_hint?: string;
    sub_queries?: PlanSubQuery[];
    [key: string]: unknown;
}
/**
 * Full reactive agent state exposed by useAgentState.
 * Every field is derived from Anvil events — no imperative set calls.
 */
export interface AgentState {
    /** Current high-level phase of the agent's thinking loop. */
    phase: AgentPhase;
    /** The original task/question that was submitted. */
    task: string | null;
    /** The active session ID. */
    sessionId: string | null;
    /** Timeline of plan.step events — every state transition, in order. */
    planSteps: PlanStep[];
    /** The last plan object received from the show_plan_step frontend call. */
    plan: AgentPlan | null;
    /** All sources discovered so far (deduplicated by URL). */
    sources: AgentSource[];
    /** Number of search steps completed (plan.step with search/find intent, status=done). */
    searchesDone: number;
    /** Number of page-reading steps completed (plan.step with read/extract intent, status=done). */
    pagesRead: number;
    /** Index into planSteps of the most recently received step. */
    currentStepIndex: number;
    /** Accumulated answer text from answer.chunk events. */
    currentAnswer: string;
    /** Whether the agent is actively streaming an answer. */
    isStreaming: boolean;
    /** Structured error info, if the agent encountered an error. */
    error: AgentError | null;
    /** Whether the terminal 'done' event has been received. */
    doneReceived: boolean;
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
export declare function reduceAgentState(state: AgentState, event: AnvilEvent<unknown>): AgentState;
/**
 * Reduce an array of AnvilEvents into a single AgentState.
 *
 * @param events  Ordered array of events (oldest first).
 * @returns       Final AgentState after processing all events.
 */
export declare function reduceAgentStateFromEvents(events: AnvilEvent[]): AgentState;
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
    sharedEvents?: AnvilEvent[];
}
/**
 * Subscribe to an Anvil session's raw events and derive a high-level
 * `AgentState` that tracks the agent's thinking process in real time.
 *
 * Two modes:
 *
 * **sharedEvents mode** (recommended for composability):
 * ```tsx
 * const [sharedEvents, setSharedEvents] = useState<AnvilEvent[]>([]);
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
    onEvent?: (e: AnvilEvent) => void;
    /** Called when a frontend tool call needs to be executed. */
    onToolCall?: (call: {
        callId: string;
        name: string;
        input: unknown;
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
export declare function useEvents<T = unknown>(sessionId: string | null, onEvent?: (e: AnvilEvent<T>) => void): {
    events: AnvilEvent<T>[];
    clear: () => void;
    lastId: number;
};
export declare function useAnvilEvent<T = unknown>(sessionId: string | null, type: EventType, handler: (e: AnvilEvent<T>) => void): void;
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
export declare function useChat(sessionId: string | null, events?: AnvilEvent[]): {
    messages: ChatMessage[];
};
export { useAgent } from "./useAgent";
export type { ToolHandler, ToolDefinition, ToolRenderer, UseAgentOptions, UseAgentReturn, PendingInterrupt } from "./useAgent";
//# sourceMappingURL=index.d.ts.map