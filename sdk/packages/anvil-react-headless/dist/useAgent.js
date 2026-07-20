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
import { useCallback, useState } from "react";
import { useSession, useChat, useAgentState, } from ".";
// ── Hook ─────────────────────────────────────────────────────────
export function useAgent(options = {}) {
    const { sessionId: initialSessionId, tools: toolHandlers = {}, renderTool: _renderers, // consumed by the React package's AgentUI component
    onStatusChange, onEvent: onEventCb, onStreamToggle: _onStreamToggle, } = options;
    // Shared event stream (single source of truth)
    const [sharedEvents, setSharedEvents] = useState([]);
    // Session lifecycle
    const session = useSession({
        sessionId: initialSessionId,
        onEvent: useCallback((e) => {
            setSharedEvents((prev) => [...prev, e]);
            onEventCb?.(e);
            if (e.type === "error")
                onStatusChange?.("error");
            if (e.type === "done") {
                onStatusChange?.("done");
            }
        }, [onEventCb, onStatusChange]),
        // Wire up tools: if the agent calls a frontend tool, execute the handler
        onToolCall: useCallback(async (call) => {
            const handler = toolHandlers[call.name];
            if (!handler)
                return null;
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
    const send = useCallback(async (text) => {
        if (!text.trim())
            return;
        setSharedEvents([]);
        try {
            const sid = await session.start(text);
            return sid;
        }
        catch (err) {
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
//# sourceMappingURL=useAgent.js.map