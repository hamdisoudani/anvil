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
import { type AnvilEvent, type ChatMessage, type UseSessionResult, type AgentState } from ".";
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
    session: UseSessionResult;
}
export declare function useAgent(options?: UseAgentOptions): UseAgentReturn;
//# sourceMappingURL=useAgent.d.ts.map