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
 *
 * Designed to be UI-agnostic. Bring your own components.
 */
import { type ReactNode } from "react";
import { AnvilClient, type AnvilEvent, type EventType, type Subscription, type ClientConfig } from "@anvil/client";
export type { AnvilEvent, EventType, Subscription, ClientConfig };
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
    /** Send a new task. Replaces any existing session. */
    start: (task: string) => Promise<string>;
    /** Resume a paused session. */
    resume: (sessionId: string) => Promise<string>;
    /** Cancel the current session (close the subscription). */
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
//# sourceMappingURL=index.d.ts.map