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
import { type ReactNode } from "react";
import { type AnvilEvent, type ChatMessage, type UseSessionResult, type AgentState, type ToolStage, type ToolOutcome } from ".";
/** Tool handler: a function the developer provides to execute a tool */
export type ToolHandler<I = any, O = any> = (input: I) => Promise<O>;
/** A registered tool with its handler */
export interface ToolDefinition<I = any, O = any> {
    description?: string;
    inputSchema?: Record<string, any>;
    execute: ToolHandler<I, O>;
}
/**
 * Strongly-typed tool renderer. Receives the full lifecycle context
 * (stage, outcome, input) so the UI can render any stage — pending
 * spinners, executing progress, success result, or error.
 *
 * Used for BOTH frontend tools (browser-side) AND server tools
 * (the agent called them, here's the result). The renderer fires
 * for both so the developer gets a unified API.
 *
 * @example
 *   renderTool: {
 *     get_weather: ({ input, result, stage, outcome }) => {
 *       if (stage === "pending") return <Spinner />;
 *       if (outcome?.success === false) return <Error err={outcome.error} />;
 *       return <WeatherCard city={input.city} data={result} />;
 *     }
 *   }
 */
export type ToolRendererContext<I = any, O = any> = {
    /** The raw input the agent passed to the tool. */
    input: I;
    /** The tool result (only set when stage === "completed" && outcome.success). */
    result?: O;
    /** The error message (only set when stage === "completed" && !outcome.success). */
    error?: string;
    /** The current lifecycle stage. */
    stage: ToolStage;
    /** The discriminated outcome (only set when stage === "completed"). */
    outcome?: ToolOutcome;
    /** True for browser-side tools. */
    isFrontend: boolean;
};
export type ToolRenderer<I = any, O = any> = (ctx: ToolRendererContext<I, O>) => ReactNode;
/**
 * Map of tool-name → custom UI renderer. Used by `ChatUI` to render
 * tool calls (frontend OR server tools) with the developer's React
 * component instead of the default JSON dump.
 *
 * If a tool is in this map, its renderer runs at every stage so you
 * can show pending spinners, executing progress, success UI, or error UI.
 * If a tool is NOT in this map, the default rendering is used.
 */
export type RenderToolMap = Record<string, ToolRenderer>;
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
    /** Thread ID to resume (loads history from backend automatically). */
    threadId?: string;
    /** Tool handlers: name → handler function */
    tools?: Record<string, ToolHandler | ToolDefinition>;
    /**
     * Generative UI renderers for tools (both frontend + server tools).
     * Each renderer receives `{input, result, error, stage, outcome, isFrontend}`
     * so it can render pending spinners, success UI, errors, etc.
     */
    renderTool?: RenderToolMap;
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
    messages: ChatMessage[];
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
    send: (text: string, opts?: {
        threadId?: string;
        focus?: string;
    }) => Promise<{
        sessionId: string;
        threadId: string;
    } | void>;
    /** Cancel the current agent run */
    cancel: () => void;
    /** Reset everything / start a new thread */
    reset: () => void;
    sessionId: string | null;
    status: UseSessionResult["status"];
    /** The current interrupt waiting for user input, if any. */
    pendingInterrupt: PendingInterrupt | null;
    /** Approve the current interrupt with a result. Auto-sends to agent. */
    approveInterrupt: (result: any) => void;
    /** Reject the current interrupt. Agent gets an error. */
    rejectInterrupt: (reason?: string) => void;
    events: AnvilEvent[];
    renderTool?: RenderToolMap;
    session: UseSessionResult;
}
export declare function useAgent(options?: UseAgentOptions): UseAgentReturn;
//# sourceMappingURL=useAgent.d.ts.map