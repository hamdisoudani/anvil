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
import { useCallback, useState, useRef, useEffect, startTransition } from "react";
import { useSession, useChat, useAgentState, } from ".";
// ── Hook ─────────────────────────────────────────────────────────
export function useAgent(options = {}) {
    const { sessionId: initialSessionId, tools: toolHandlers = {}, onStatusChange, onEvent: onEventCb, onInterrupt, } = options;
    // Shared event stream (single source of truth)
    const [sharedEvents, setSharedEvents] = useState([]);
    // Pending interrupt state
    const [pendingInterrupt, setPendingInterrupt] = useState(null);
    const pendingInterruptRef = useRef(null);
    // Track active tool calls (callId → resolvers) for frontend tools
    const activeToolCalls = useRef(new Map());
    // Session lifecycle - use ref to avoid stale closures in the event handler
    const sessionRef = useRef(null);
    const onEvent = useCallback((e) => {
        setSharedEvents((prev) => [...prev, e]);
        onEventCb?.(e);
        if (e.type === "error")
            onStatusChange?.("error");
        if (e.type === "done")
            onStatusChange?.("done");
    }, [onEventCb, onStatusChange]);
    // Handle tool calls — both server tools and frontend tools (interrupts)
    const onToolCall = useCallback(async (call) => {
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
            return new Promise((resolve, reject) => {
                const interrupt = {
                    callId: call.callId,
                    toolName: call.name,
                    input: call.input,
                    isFrontend: true,
                    resolve,
                    reject: (err) => reject(new Error(err)),
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
    const startRef = useRef();
    const cancelRef = useRef();
    useEffect(() => {
        startRef.current = session.start;
        cancelRef.current = session.cancel;
    }, [session.start, session.cancel]);
    // Track the active thread ID in state so consumers re-render when it changes.
    const [threadId, setThreadId] = useState(null);
    const threadIdRef = useRef(null);
    // Send: start a new run or continue. When `opts.threadId` is given
    // (or the previous run produced one), events from this session are
    // APPENDED to the existing log so multi-turn history stays visible.
    // Only an explicit `reset()` (or a brand-new thread) clears the log.
    const send = useCallback(async (text, opts) => {
        if (!text.trim())
            return;
        const tid = opts?.threadId ?? threadIdRef.current ?? undefined;
        // Always clear any leftover interrupt from a prior session before
        // starting a new run. The shared event log is preserved across
        // multi-turn messages in the same thread (we just append).
        setPendingInterrupt(null);
        pendingInterruptRef.current = null;
        try {
            const result = await startRef.current?.(text, tid ? { threadId: tid } : undefined);
            if (result) {
                threadIdRef.current = result.threadId;
                setThreadId(result.threadId);
            }
            return result;
        }
        catch (err) {
            console.error("useAgent.send failed:", err);
            throw err;
        }
    }, []);
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
    const approveInterrupt = useCallback((result) => {
        const intr = pendingInterruptRef.current;
        if (!intr)
            return;
        intr.resolve(result);
        setPendingInterrupt(null);
        pendingInterruptRef.current = null;
    }, []);
    const rejectInterrupt = useCallback((reason = "Interrupted by user") => {
        const intr = pendingInterruptRef.current;
        if (!intr)
            return;
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
//# sourceMappingURL=useAgent.js.map