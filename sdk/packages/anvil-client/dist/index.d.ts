/**
 * Anvil client — framework-agnostic.
 *
 * The client speaks the Anvil wire protocol:
 *   - POST /tasks                       start a session (optionally continuing a thread_id)
 *   - GET  /sessions/:id/events         live stream (SSE)
 *   - GET  /sessions/:id/events?since=N resume from N
 *   - POST /sessions/:id/tool           deliver a frontend tool result
 *   - POST /sessions/:id/resume         resume from checkpoint
 *   - GET  /sessions/:id/status         current step, drop count
 *
 * This is the lowest layer. It knows nothing about React. It emits
 * typed events and handles reconnection. Use it directly in vanilla
 * JS, Vue, Svelte, server-side, anywhere.
 */
export type EventType = "session.start" | "session.resume" | "think.start" | "think.chunk" | "think.end" | "tool.call" | "tool.result" | "checkpoint" | "subagent" | "anvil.dropped" | "subscriber.dropped" | "error" | "done" | "paused" | string;
export interface AnvilEvent<T = unknown> {
    /** Monotonic ID assigned by the engine. Use for Last-Event-ID resume. */
    id: number;
    type: EventType;
    sessionId: string;
    payload: T;
    createdAt: string;
}
export interface FrontendToolCall<TInput = unknown> {
    callId: string;
    name: string;
    input: TInput;
}
export interface SessionStatus {
    sessionId: string;
    step: number;
    subCount: number;
}
export interface ClientConfig {
    /** Base URL of the Anvil HTTP server. e.g. "http://localhost:8080" */
    baseUrl: string;
    /** Custom fetch impl (for SSR, tests, or auth headers). */
    fetch?: typeof fetch;
    /** Custom EventSource impl (for Node tests). */
    EventSource?: typeof EventSource;
    /** Called when a server-side drop is detected. */
    onServerDrop?: (event: AnvilEvent) => void;
    /** Called when a subscriber drop marker arrives. */
    onSubscriberDrop?: (event: AnvilEvent) => void;
}
/** Subscription handle returned by subscribe(). */
export interface Subscription {
    /** Stop receiving events. */
    unsubscribe: () => void;
    /** Number of events received so far. */
    count: () => number;
    /** Last event id seen (for resume on reconnect). */
    lastEventId: () => number;
    /** Current state: connecting | open | closed. */
    state: () => "connecting" | "open" | "closed";
}
export declare class AnvilClient {
    private config;
    constructor(config: ClientConfig);
    /**
     * Start a new agent task (optionally continuing an existing thread).
     *
     * Pass `opts.threadId` to continue an existing conversation thread;
     * the server will create a fresh session bound to that thread and
     * the new session's events will be appended to the thread's history.
     *
     * Returns the new sessionId, the threadId (echoed back; may equal the
     * provided threadId or a fresh one if none was given), and the SSE
     * stream URL for this session.
     */
    startTask(task: string, opts?: {
        threadId?: string;
    }): Promise<{
        sessionId: string;
        threadId: string;
        streamUrl: string;
    }>;
    /** Resume a paused session. */
    resume(sessionId: string): Promise<{
        sessionId: string;
        streamUrl: string;
    }>;
    /** Get current session status. */
    status(sessionId: string): Promise<SessionStatus>;
    /**
     * Deliver a frontend tool result back to the engine.
     * Called by the browser-side executor when it finishes a FrontendTool.
     */
    deliverToolResult(sessionId: string, callId: string, result: unknown, error?: string): Promise<void>;
    /**
     * Subscribe to events for a session. Returns a Subscription handle.
     *
     * Handles reconnection with Last-Event-ID automatically — if the
     * connection drops, we reconnect with `?since=<last id>` and the
     * server replays any missed events.
     */
    subscribe<T = unknown>(sessionId: string, onEvent: (e: AnvilEvent<T>) => void): Subscription;
}
//# sourceMappingURL=index.d.ts.map