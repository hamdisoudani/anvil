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
}
export declare function AnvilPerplexity({ className, defaultFocus, }: AnvilPerplexityProps): import("react").JSX.Element;
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool, useAgentState, type AnvilEvent, type AnyAnvilEvent, type ChatMessage, } from "@anvil/react-headless";
export { Message, MessageContent, MessageAvatar } from "./components/ai-elements/message";
export { Conversation, ConversationContent, ConversationEmptyState } from "./components/ai-elements/conversation";
export { Response } from "./components/ai-elements/response";
export { Sources, SourcesTrigger, SourcesContent, Source } from "./components/ai-elements/sources";
export { Reasoning, ReasoningTrigger, ReasoningContent } from "./components/ai-elements/reasoning";
export { Loader } from "./components/ai-elements/loader";
export { Actions, Action } from "./components/ai-elements/actions";
export { ErrorBanner } from "./components/ai-elements/error-banner";
export { useAgent } from "@anvil/react-headless";
export type { ToolHandler, UseAgentOptions, UseAgentReturn, PendingInterrupt, AgentError } from "@anvil/react-headless";
export { AgentUI } from "./components/agent-ui";
export { ChatUI } from "./components/chat-ui";
export type { ChatUIProps } from "./components/chat-ui";
export { AgentThinking, AgentThinkingInline } from "./components/agent-thinking";
//# sourceMappingURL=index.d.ts.map