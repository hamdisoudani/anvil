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
  type EventType,
  type Subscription,
  type ClientConfig,
} from "@anvil/client";

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
  onEvent?: (e: AnvilEvent) => void;
  /** Called when a frontend tool call needs to be executed. */
  onToolCall?: (call: { callId: string; name: string; input: unknown }) =>
    Promise<unknown> | unknown;
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

export function useSession(opts: UseSessionOptions = {}): UseSessionResult {
  const { client, getTool } = useAnvil();
  const [sessionId, setSessionId] = useState<string | null>(opts.sessionId ?? null);
  const [status, setStatus] = useState<UseSessionResult["status"]>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [lastEventId, setLastEventId] = useState(0);
  const subRef = useRef<Subscription | null>(null);

  const onEventRef = useRef(opts.onEvent);
  const onToolCallRef = useRef(opts.onToolCall);
  onEventRef.current = opts.onEvent;
  onToolCallRef.current = opts.onToolCall;

  const subscribe = useCallback((id: string) => {
    subRef.current?.unsubscribe();
    setStatus("running");
    setEventCount(0);
    setLastEventId(0);
    subRef.current = client.subscribe(id, async (e) => {
      setEventCount((c) => c + 1);
      setLastEventId(e.id);
      onEventRef.current?.(e);

      // Handle tool calls — either via onToolCall or the registry
      if (e.type === "tool.call") {
        const p = e.payload as { id: string; name: string; input: unknown; is_frontend?: boolean };
        if (p.is_frontend) {
          // Map server's "id" to our "callId"
          const call = { callId: p.id, name: p.name, input: p.input };
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

  // Auto-resume on mount if sessionId provided
  useEffect(() => {
    if (opts.sessionId) {
      subscribe(opts.sessionId);
      return () => subRef.current?.unsubscribe();
    }
    return undefined;
  }, [opts.sessionId, subscribe]);

  const start = useCallback(async (task: string) => {
    setStatus("starting");
    setError(null);
    try {
      const { sessionId: newId } = await client.startTask(task);
      setSessionId(newId);
      subscribe(newId);
      return newId;
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
    subRef.current?.unsubscribe();
    subRef.current = null;
    setStatus("idle");
  }, []);

  return { sessionId, status, error, start, resume, cancel, eventCount, lastEventId };
}

// ── useEvents: typed event log for a session ─────────────────────

export function useEvents<T = unknown>(
  sessionId: string | null,
  onEvent?: (e: AnvilEvent<T>) => void,
) {
  const { client } = useAnvil();
  const [events, setEvents] = useState<AnvilEvent<T>[]>([]);
  const subRef = useRef<Subscription | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      return undefined;
    }
    subRef.current = client.subscribe<T>(sessionId, (e) => {
      setEvents((prev) => [...prev, e]);
      onEventRef.current?.(e);
    });
    return () => subRef.current?.unsubscribe();
  }, [sessionId, client]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, clear, lastId: events.at(-1)?.id ?? 0 };
}

// ── useAnvilEvent: subscribe to a specific event type ─────────────

export function useAnvilEvent<T = unknown>(
  sessionId: string | null,
  type: EventType,
  handler: (e: AnvilEvent<T>) => void,
) {
  const { client } = useAnvil();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!sessionId) return undefined;
    const sub = client.subscribe<T>(sessionId, (e) => {
      if (e.type === type) handlerRef.current(e);
    });
    return () => sub.unsubscribe();
  }, [sessionId, type, client]);
}

// ── useFrontendTool: declare a browser-side tool ─────────────────

export function useFrontendTool<TInput = unknown, TOutput = unknown>(
  tool: FrontendToolExecutor<TInput, TOutput>,
) {
  const { registerTool } = useAnvil();
  useEffect(() => {
    return registerTool(tool);
  }, [registerTool, tool]);
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

export function useChat(sessionId: string | null) {
  const { events } = useEvents<any>(sessionId);
  const messages = useMemo<ChatMessage[]>(() => {
    const out: ChatMessage[] = [];
    let currentAssistant: ChatMessage | null = null;
    let subAgents = new Map<string, ChatMessage>();

    for (const e of events) {
      switch (e.type) {
        case "session.start": {
          // The user message is the task itself; emit it once.
          const task = (e.payload as any)?.task as string | undefined;
          if (task) {
            out.push({
              id: `user-${e.id}`,
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
              id: `assistant-${e.id}`,
              role: "assistant",
              content: "",
              timestamp: Date.parse(e.createdAt),
              isStreaming: true,
            };
            out.push(currentAssistant);
          }
          currentAssistant.content += delta;
          // Trigger re-render — push a new object each chunk
          const idx = out.indexOf(currentAssistant);
          if (idx >= 0) {
            out[idx] = { ...currentAssistant };
          }
          break;
        }
        case "think.end": {
          if (currentAssistant) {
            currentAssistant.isStreaming = false;
            const idx = out.indexOf(currentAssistant);
            if (idx >= 0) {
              out[idx] = { ...currentAssistant };
            }
            currentAssistant = null;
          }
          break;
        }
        case "tool.call": {
          const p = e.payload as any;
          out.push({
            id: `tool-call-${e.id}`,
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
          // Attach to the current (last) assistant message
          for (let i = out.length - 1; i >= 0; i--) {
            const m = out[i];
            if (m && m.role === "assistant") {
              out[i] = { ...m, sources };
              break;
            }
          }
          break;
        }
        case "frontend.call": {
          // Attach the call's data to the current assistant message
          const p = e.payload as any;
          if (p.name === "show_related" && p.input && p.input.questions) {
            for (let i = out.length - 1; i >= 0; i--) {
              const m = out[i];
              if (m && m.role === "assistant") {
                out[i] = { ...m, related: p.input.questions };
                break;
              }
            }
          }
          break;
        }
        case "done": {
          // The final done event may include sources/related at the top level
          // and should mark the assistant message as done streaming.
          const p = e.payload as any;
          
          // Find the last assistant message and mark it as done
          for (let i = out.length - 1; i >= 0; i--) {
            const m = out[i];
            if (m && m.role === "assistant") {
              out[i] = { 
                ...m, 
                isStreaming: false,
                sources: m.sources ?? p.sources, 
                related: m.related ?? p.related 
              };
              break;
            }
          }
          
          if (currentAssistant) {
            currentAssistant.isStreaming = false;
            const idx = out.indexOf(currentAssistant);
            if (idx >= 0) {
              out[idx] = { ...currentAssistant };
            }
            currentAssistant = null;
          }
          break;
        }
      }
    }
    return out;
  }, [events]);

  return { messages };
}
