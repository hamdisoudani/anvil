/**
 * Conversation — auto-scrolling chat container.
 *
 * Wraps messages in a flex column. When new content is added, scrolls
 * to bottom. The sticky "scroll to bottom" button appears when the
 * user has scrolled up.
 */
import * as React from "react";
interface ConversationContextValue {
    isAtBottom: boolean;
    scrollToBottom: () => void;
}
export declare function useConversation(): ConversationContextValue | null;
interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {
}
export declare function Conversation({ className, children, ...props }: ConversationProps): React.JSX.Element;
interface ConversationContentProps extends React.HTMLAttributes<HTMLDivElement> {
}
export declare function ConversationContent({ className, children, ...props }: ConversationContentProps): React.JSX.Element;
export declare function ConversationEmptyState({ title, description, icon, className, }: {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    className?: string;
}): React.JSX.Element;
export {};
//# sourceMappingURL=conversation.d.ts.map