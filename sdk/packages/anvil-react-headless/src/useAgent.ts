"use client";

/**
 * useAgent — The ONE hook to build any Anvil agent UI.
 *
 * Wraps useSession + useChat + useAgentState + tool execution +
 * interrupt handling into a single, no-config API.
 *
 * A developer can build a fully working agent UI with just this
 * hook + <AgentUI agent={agent} />.
 *
 * Minimal:
 *   const agent = useAgent();
 *   agent.send("hello");
 *
 * With tools + generative UI:
 *   const agent = useAgent({
 *     tools: { get_weather: async ({ city }) => ... },
 *     renderTool: { weather_card: (data) => <WeatherCard {...data} /> },
 *   });
 *
 * With approval dialogs (auto-detected from server):
 *   // No extra config! When the agent emits an interrupt with
 *   // is_frontend: true, the hook captures it and stores it in
 *   // agent.pendingInterrupt. The <AgentUI> component shows the
 *   // dialog automatically.
 *
 * How interrupts work (the Anvil edge):
 *   - Agent calls FrontendTool.Execute(args) → BLOCKS
 *   - Event { type: "tool.call", is_frontend: true, name, input } goes to browser
 *   - useAgent detects it, stores in .pendingInterrupt
 *   - Developer (or AgentUI) renders a dialog/form
 *   - agent.approveInterrupt(result) is called → sends result back
 *   - Agent receives result and CONTINUES from where it paused
 *
 * This is the SAME tool interface. No special interrupt config.
 * Anvil is the only framework where HITL is just a tool call.
 */
import { useMemo, useCallback, useState, useRef, useEffect, startTransition, type ReactNode } from "react";
import {
  useSession,
  useChat,
  useAgentState,
  type AnvilEvent,
  type AnyAnvilEvent,
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

/** Tool renderer: renders a tool result as a React node */
export type ToolRenderer = (data: any) => ReactNode;

/** An active interrupt from the agent, waiting for user input. */
export interface PendingInterrupt {
  /** The call ID (used to send the result back). */
  callId: string;
  /** The tool name (e.g. "approve_deploy", "render_chart"). */
  toolName: string;
  /** The input payload from the agent. */
  input: any;
  /** Whether this is a frontend-originating interrupt. */
  isFrontend: boolean;
  /** Resolve this interrupt with a result. */
  resolve: (result: any) => void;
  /** Reject this interrupt (agent gets an error). */
  reject: (error: string) => void;
  /** The agent is waiting for this — component should display UI. */
  timestamp: number;
}

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
  /** Called when the agent requests an interrupt (approval/form/etc.) */
  onInterrupt?: (interrupt: PendingInterrupt) => void;
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

  /** Active conversation thread ID, if the server supplied one. */
  threadId: string | null;
  /**
   * Send a message to the agent. Pass `threadId` to continue an
   * existing multi-session conversation. Events remain in the shared
   * log; call `reset()` to explicitly start a new thread.
   */
  send: (
    text: string,
    opts?: { threadId?: string; focus?: string },
  ) => Promise<{ sessionId: string; threadId: string } | void>;
  /** Cancel the current agent run */
  cancel: () => void;
  /** Reset everything / start a new thread */
  reset: () => void;

  // ── Session info ──
  sessionId: string | null;
  status: UseSessionResult["status"];

  // ── Interrupt / HITL ──
  /** The current interrupt waiting for user input, if any. */
  pendingInterrupt: PendingInterrupt | null;
  /** Approve the current interrupt with a result. Auto-sends to agent. */
  approveInterrupt: (result: any) => void;
  /** Reject the current interrupt. Agent gets an error. */
  rejectInterrupt: (reason?: string) => void;

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
    onStatusChange,
    onEvent: onEventCb,
    onInterrupt,
  } = options;

  // Shared event stream (single source of truth)
  const [sharedEvents, setSharedEvents] = useState<AnvilEvent[]>([]);

  // Pending interrupt state
  const [pendingInterrupt, setPendingInterrupt] = useState<PendingInterrupt | null>(null);
  const pendingInterruptRef = useRef<PendingInterrupt | null>(null);

  // Extract tool specs (name, description, inputSchema) from the
  // developer's `tools` map. These are sent to the server so the LLM
  // knows which frontend tools are available. The `execute` functions
  // stay in the browser — only the metadata travels.
  const frontendToolSpecs = useMemo(() => {
    return Object.entries(toolHandlers).map(([name, def]) => {
      if (typeof def === "function") {
        return { name, description: "", inputSchema: { type: "object", properties: {} } };
      }
      return {
        name,
        description: def.description ?? "",
        inputSchema: def.inputSchema ?? { type: "object", properties: {} },
      };
    });
  }, [toolHandlers]);

  // Track active tool calls (callId → resolvers) for frontend tools
  const activeToolCalls = useRef<Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>>(new Map());

  // Session lifecycle - use ref to avoid stale closures in the event handler
  const sessionRef = useRef<any>(null);

  const onEvent = useCallback((e: AnyAnvilEvent) => {
    // Narrow once at the SDK boundary. Unknown event types come
    // through the SSE pipe for forward-compatibility — the reducer
    // never crashes on them, the consumer never sees them.
    if ("_unknown" in e) return;
    const ev: AnvilEvent = e;

    setSharedEvents((prev) => [...prev, ev]);
    onEventCb?.(ev);
    if (ev.type === "error") onStatusChange?.("error");
    if (ev.type === "done") onStatusChange?.("done");

  }, [onEventCb, onStatusChange]);

  // Handle tool calls — both server tools and frontend tools (interrupts)
  const onToolCall = useCallback(async (call: { callId: string; name: string; input: unknown; isFrontend?: boolean }) => {
    // Check if developer registered a handler for this tool
    const handler = toolHandlers[call.name];
    if (handler) {
      const fn = typeof handler === "function" ? handler : handler.execute;
      return fn(call.input);
    }

    // No handler registered — this is either an interrupt or an unhandled tool.
    // If it's a frontend tool (the FrontendTool from Go server), create a
    // pending interrupt and return a promise that resolves when the user responds.
    if (call.isFrontend) {
      return new Promise<any>((resolve, reject) => {
        const interrupt: PendingInterrupt = {
          callId: call.callId,
          toolName: call.name,
          input: call.input,
          isFrontend: true,
          resolve,
          reject: (err: string) => reject(new Error(err)),
          timestamp: Date.now(),
        };

        // Store in ref for synchronous access
        pendingInterruptRef.current = interrupt;

        // Trigger React re-render and callback
        startTransition(() => {
          setPendingInterrupt(interrupt);
          onInterrupt?.(interrupt);
        });
      });
    }

    // Unknown tool — return null (useSession will handle this as a no-op)
    return null;
  }, [toolHandlers, onInterrupt]);

  const session = useSession({
    sessionId: initialSessionId,
    onEvent,
    onToolCall,
  });

  // Keep the ref in sync with the hook instance
  useEffect(() => {
    sessionRef.current = session;
  });

  // Chat messages + Agent state
  const { messages } = useChat(session.sessionId, sharedEvents);
  const agentState = useAgentState({ sharedEvents });

  // Derived state
  const isProcessing = session.status === "running" || session.status === "starting";
  const isDone = session.status === "done";
  const error = agentState.error?.message ?? session.error?.message ?? null;

  // Store session methods in refs so callbacks don't depend on session object identity
  const startRef = useRef<
    | ((
        task: string,
        opts?: { threadId?: string; focus?: string },
      ) => Promise<{ sessionId: string; threadId: string }>)
    | null
  >(null);
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    startRef.current = session.start;
    cancelRef.current = session.cancel;
  }, [session.start, session.cancel]);

  // Track the active thread ID in state so consumers re-render when it changes.
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);

  // Send: start a new run or continue. When `opts.threadId` is given
  // (or the previous run produced one), events from this session are
  // APPENDED to the existing log so multi-turn history stays visible.
  // Only an explicit `reset()` (or a brand-new thread) clears the log.
  const send = useCallback(
    async (
      text: string,
      opts?: { threadId?: string; focus?: string },
    ): Promise<{ sessionId: string; threadId: string } | void> => {
      if (!text.trim()) return;
      const tid = opts?.threadId ?? threadIdRef.current ?? undefined;
      // Always clear any leftover interrupt from a prior session before
      // starting a new run. The shared event log is preserved across
      // multi-turn messages in the same thread (we just append).
      setPendingInterrupt(null);
      pendingInterruptRef.current = null;
      try {
        const result = await startRef.current?.(text, {
          ...(tid ? { threadId: tid } : {}),
          ...(opts?.focus ? { focus: opts.focus } : {}),
          ...(frontendToolSpecs.length > 0 ? { frontendTools: frontendToolSpecs } : {}),
        });
        if (result) {
          threadIdRef.current = result.threadId;
          setThreadId(result.threadId);
        }
        return result;
      } catch (err) {
        console.error("useAgent.send failed:", err);
        throw err;
      }
    },
    [],
  );

  // Cancel
  const cancel = useCallback(() => {
    cancelRef.current?.();
  }, []);

  // Reset: cancel + clear events + forget thread
  const reset = useCallback(() => {
    setSharedEvents([]);
    setPendingInterrupt(null);
    pendingInterruptRef.current = null;
    threadIdRef.current = null;
    setThreadId(null);
    cancelRef.current?.();
  }, []);

  // Approve/reject interrupt
  const approveInterrupt = useCallback((result: any) => {
    const intr = pendingInterruptRef.current;
    if (!intr) return;
    intr.resolve(result);
    setPendingInterrupt(null);
    pendingInterruptRef.current = null;
  }, []);

  const rejectInterrupt = useCallback((reason = "Interrupted by user") => {
    const intr = pendingInterruptRef.current;
    if (!intr) return;
    intr.reject(reason);
    setPendingInterrupt(null);
    pendingInterruptRef.current = null;
  }, []);

  return {
    messages,
    state: agentState,
    isProcessing,
    isDone,
    error,
    sessionId: session.sessionId,
    threadId,
    status: session.status,
    send,
    cancel,
    reset,
    pendingInterrupt,
    approveInterrupt,
    rejectInterrupt,
    events: sharedEvents,
    session,
  };
}
