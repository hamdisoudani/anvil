/**
 * useAgent — The ONE hook to build any Anvil agent UI.
 *
 * Wraps useSession + useChat + useAgentState + tool execution into
 * a single, no-config API. A developer can build a fully working
 * agent UI with just this hook + a few components.
 *
 * Minimal example:
 * ```tsx
 * function MyAgent() {
 *   const agent = useAgent();
 *
 *   return (
 *     <div>
 *       {agent.messages.map(m => (
 *         <div key={m.id}>
 *           <strong>{m.role}:</strong> {m.text}
 *         </div>
 *       ))}
 *       <form onSubmit={(e) => { e.preventDefault(); agent.send(input); }}>
 *         <input onChange={(e) => setInput(e.target.value)} />
 *       </form>
 *     </div>
 *   );
 * }
 * ```
 *
 * Full example with tools + generative UI:
 * ```tsx
 * function WeatherAgent() {
 *   const agent = useAgent({
 *     tools: {
 *       get_weather: async ({ city }) => {
 *         const res = await fetch(`/api/weather?city=${city}`);
 *         return res.json();
 *       },
 *     },
 *     renderTool: {
 *       weather_card: (data) => <WeatherCard temp={data.temp} />,
 *       search_results: (results) => <SearchList items={results} />,
 *     },
 *   });
 *
 *   return <AgentUI agent={agent} />;
 * }
 * ```
 */
import { useMemo, useCallback, useState } from "react";
import {
  useSession,
  useChat,
  useAgentState,
  type AnvilEvent,
  type ChatMessage,
  type UseSessionResult,
  type AgentState,
} from ".";

// ── Types ────────────────────────────────────────────────────────

/** Tool handler: a function the developer provides to execute a tool */
export type ToolHandler<I = any, O = any> = (input: I) => Promise<O>;

/** A registered tool with its handler */
export interface ToolDefinition<I = any, O = any> {
  description?: string;
  inputSchema?: Record<string, any>;
  execute: ToolHandler<I, O>;
}

interface ToolContext {
  sessionId: string;
  messageId?: string;
}

/** Tool renderer: renders a tool result as a React node */
export type ToolRenderer = (data: any) => React.ReactNode;

/** Options for useAgent */
export interface UseAgentOptions {
  /** URL or baseUrl of the Anvil agent server */
  url?: string;
  /** Session ID to resume (for thread reload) */
  sessionId?: string;
  /** Tool handlers: name → handler function */
  tools?: Record<string, ToolHandler | ToolDefinition>;
  /** Generative UI renderers: tool name → React component */
  renderTool?: Record<string, ToolRenderer>;
  /** Called when the agent's status changes */
  onStatusChange?: (status: string) => void;
  /** Called for each event received */
  onEvent?: (event: AnvilEvent) => void;
  /** Called when streaming starts/stops */
  onStreamToggle?: (streaming: boolean) => void;
}

/** The full agent API returned by useAgent */
export interface UseAgentReturn {
  // ── Messages (the chat history) ──
  messages: ChatMessage[];

  // ── Agent state (thinking phase) ──
  state: AgentState;
  isProcessing: boolean;
  isDone: boolean;
  error: string | null;

  // ── Session info ──
  sessionId: string | null;
  status: UseSessionResult["status"];

  // ── Actions ──
  /** Send a message to the agent */
  send: (text: string) => Promise<string | void>;
  /** Cancel the current agent run */
  cancel: () => void;
  /** Reset everything / start a new thread */
  reset: () => void;

  // ── Events (raw stream, for custom UIs) ──
  events: AnvilEvent[];

  // ── Session (low-level access, for advanced use) ──
  session: UseSessionResult;
}

// ── Hook ─────────────────────────────────────────────────────────

export function useAgent(options: UseAgentOptions = {}): UseAgentReturn {
  const {
    sessionId: initialSessionId,
    tools: toolHandlers = {},
    renderTool: _renderers, // consumed by the React package's AgentUI component
    onStatusChange,
    onEvent: onEventCb,
    onStreamToggle: _onStreamToggle,
  } = options;

  // Shared event stream (single source of truth)
  const [sharedEvents, setSharedEvents] = useState<AnvilEvent[]>([]);

  // Session lifecycle
  const session = useSession({
    sessionId: initialSessionId,
    onEvent: useCallback((e: AnvilEvent) => {
      setSharedEvents((prev) => [...prev, e]);
      onEventCb?.(e);
      if (e.type === "error") onStatusChange?.("error");
      if (e.type === "done") {
        onStatusChange?.("done");
      }
    }, [onEventCb, onStatusChange]),
    // Wire up tools: if the agent calls a frontend tool, execute the handler
    onToolCall: useCallback(async (call: { callId: string; name: string; input: unknown }) => {
      const handler = toolHandlers[call.name];
      if (!handler) return null;
      const fn = typeof handler === "function" ? handler : handler.execute;
      return fn(call.input);
    }, [toolHandlers]),
  });

  // Chat messages
  const { messages } = useChat(session.sessionId, sharedEvents);

  // Agent state (thinking phases)
  const agentState = useAgentState({ sharedEvents });

  // Derived state
  const isProcessing = session.status === "running" || session.status === "starting";
  const isDone = session.status === "done";
  const error = session.error?.message ?? agentState.error ?? null;

  // Send: start a new run or continue
  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setSharedEvents([]);
    try {
      const sid = await session.start(text);
      return sid;
    } catch (err) {
      console.error("useAgent.send failed:", err);
      throw err;
    }
  }, [session]);

  // Cancel
  const cancel = useCallback(() => {
    session.cancel();
  }, [session]);

  // Reset: cancel + clear events
  const reset = useCallback(() => {
    setSharedEvents([]);
    session.cancel();
  }, [session]);

  return {
    messages,
    state: agentState,
    isProcessing,
    isDone,
    error,
    sessionId: session.sessionId,
    status: session.status,
    send,
    cancel,
    reset,
    events: sharedEvents,
    session,
  };
}
