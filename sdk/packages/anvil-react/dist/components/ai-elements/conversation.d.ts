/**
 * Conversation — auto-scrolling chat container.
 *
 * Wraps messages in a flex column. When new content is added, scrolls
 * to bottom. The sticky "scroll to bottom" button appears when the
 * user has scrolled up.
 *
 * Performance notes:
 *  - isAtBottom is stored in a ref AND mirrored into state only when
 *    it actually changes. Scroll events fire constantly during streaming;
 *    without this, every event would trigger a React rerender.
 *  - scrollToBottom is a stable ref to avoid re-subscribing the
 *    ResizeObserver effect.
 *  - The ResizeObserver effect depends on the contentRef (stable) and
 *    NOT on `children` — children change on every streamed token, so
 *    depending on them would tear down and recreate the observer each
 *    token. The observer itself handles new content automatically.
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
export declare const ConversationContent: React.NamedExoticComponent<ConversationContentProps>;
interface ConversationEmptyStateProps {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    className?: string;
}
export declare const ConversationEmptyState: React.NamedExoticComponent<ConversationEmptyStateProps>;
export {};
//# sourceMappingURL=conversation.d.ts.map