/**
 * ChatUI — Zero-config, production-grade responsive chat shell for Anvil.
 *
 * Mobile-first: safe-area insets, ≥44px touch targets, sticky input,
 * single-column layout. Desktop: centered max-w-2xl/3xl conversation.
 *
 * Usage:
 *   const agent = useAgent({ url: "/api" });
 *   return <ChatUI agent={agent} onNewThread={() => agent.reset()} />;
 */
import * as React from "react";
import type { UseAgentReturn } from "@anvil/react-headless";
export interface ChatUIProps {
    /** Return value of useAgent() — preferred path. */
    agent: UseAgentReturn;
    className?: string;
    placeholder?: string;
    title?: string;
    /** Called when user taps New chat. Defaults to agent.reset(). */
    onNewThread?: () => void;
    /** Optional header slot (right side of top bar). */
    headerRight?: React.ReactNode;
    /** Empty-state title */
    emptyTitle?: string;
    /** Empty-state description */
    emptyDescription?: string;
}
export declare function ChatUI({ agent, className, placeholder, title, onNewThread, headerRight, emptyTitle, emptyDescription, }: ChatUIProps): React.JSX.Element;
//# sourceMappingURL=chat-ui.d.ts.map