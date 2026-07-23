declare const FOCUS_MODES: readonly [{
    readonly id: "web";
    readonly label: "Web";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}, {
    readonly id: "academic";
    readonly label: "Academic";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}, {
    readonly id: "news";
    readonly label: "News";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}, {
    readonly id: "social";
    readonly label: "Social";
    readonly icon: import("react").ForwardRefExoticComponent<Omit<import("lucide-react").LucideProps, "ref"> & import("react").RefAttributes<SVGSVGElement>>;
}];
type FocusMode = (typeof FOCUS_MODES)[number]["id"];
export interface AnvilPerplexityProps {
    className?: string;
    defaultFocus?: FocusMode;
    /**
     * Override thread storage backend. Defaults to localStorage.
     * Pass a custom `ShellStorage` to use a remote DB.
     */
    storage?: import("@anvil/react-headless").ShellStorage;
    /**
     * Override URL routing strategy. Defaults to hash routing.
     * Pass a custom `ShellRouting` for pathname / query string / no-op.
     */
    routing?: import("@anvil/react-headless").ShellRouting;
}
/**
 * Public AnvilPerplexity — wraps the inner implementation with
 * <AnvilShell> for pluggable thread storage + routing and
 * <AgentProvider> so descendants can share the agent via context.
 */
export declare function AnvilPerplexity({ className, defaultFocus, storage, routing, }: AnvilPerplexityProps): import("react").JSX.Element;
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool, useAgentState, AnvilShell, useAnvilShell, useAnvilShellOptional, AgentProvider, useAgentContext, useAgentContextOptional, CheckpointProvider, useCheckpoint, useCheckpointOptional, type AnvilEvent, type AnyAnvilEvent, type ChatMessage, type ShellStorage, type ShellRouting, type ThreadMeta, type ThreadData, type CheckpointContextValue, type CheckpointProviderProps, } from "@anvil/react-headless";
export { reduceAgentState, reduceAgentStateFromEvents, reduceEventsToMessages, agentStateFromTurns, messagesFromTurns, threadToEvents, registerReducer, listCustomReducers, createCheckpointStore, captureCheckpoint, resumeFromCheckpoint, InMemoryCheckpointStore, LocalStorageCheckpointStore, RemoteCheckpointStore, } from "@anvil/client";
export type { CustomEventHandler } from "@anvil/client";
export type { Checkpoint, CheckpointStore, CheckpointStoreConfig, } from "@anvil/client";
export { Message, MessageContent, MessageAvatar } from "./components/ai-elements/message";
export { Conversation, ConversationContent, ConversationEmptyState } from "./components/ai-elements/conversation";
export { Response, type ResponseSource } from "./components/ai-elements/response";
export { Sources, SourcesTrigger, SourcesContent, Source } from "./components/ai-elements/sources";
export { Reasoning, ReasoningTrigger, ReasoningContent } from "./components/ai-elements/reasoning";
export { Loader } from "./components/ai-elements/loader";
export { Actions, Action } from "./components/ai-elements/actions";
export { ErrorBanner } from "./components/ai-elements/error-banner";
export { ToolResult, type ToolResultProps } from "./components/ai-elements/tool-result";
export { ThreadList, useThreadListToggle, type ThreadListRendererProps } from "./components/ai-elements/thread-list";
export { InterruptDialog } from "./components/interrupt-dialog";
export type { InterruptLike, InterruptDialogRendererProps, InterruptDialogProps, } from "./components/interrupt-dialog";
export { useAgent } from "@anvil/react-headless";
export type { ToolHandler, UseAgentOptions, UseAgentReturn, PendingInterrupt, AgentError } from "@anvil/react-headless";
export { AgentUI } from "./components/agent-ui";
export { ChatUI } from "./components/chat-ui";
export type { ChatUIProps } from "./components/chat-ui";
export { AgentThinking, AgentThinkingInline } from "./components/agent-thinking";
//# sourceMappingURL=index.d.ts.map