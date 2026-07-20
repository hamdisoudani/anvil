"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Conversation — auto-scrolling chat container.
 *
 * Wraps messages in a flex column. When new content is added, scrolls
 * to bottom. The sticky "scroll to bottom" button appears when the
 * user has scrolled up.
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { ArrowDown } from "lucide-react";
import { Button } from "../ui/button";
const ConversationContext = React.createContext(null);
export function useConversation() {
    return React.useContext(ConversationContext);
}
export function Conversation({ className, children, ...props }) {
    const scrollRef = React.useRef(null);
    const [isAtBottom, setIsAtBottom] = React.useState(true);
    const scrollToBottom = React.useCallback(() => {
        const el = scrollRef.current;
        if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }
    }, []);
    const onScroll = React.useCallback(() => {
        const el = scrollRef.current;
        if (!el)
            return;
        const threshold = 60;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
        setIsAtBottom(atBottom);
    }, []);
    // Auto-scroll on new content (only if user is already at bottom)
    // Use useLayoutEffect for DOM measurement, depend on children to detect new content
    React.useLayoutEffect(() => {
        if (isAtBottom) {
            const el = scrollRef.current;
            if (el)
                el.scrollTop = el.scrollHeight;
        }
    }, [isAtBottom, children]);
    return (_jsx(ConversationContext.Provider, { value: { isAtBottom, scrollToBottom }, children: _jsxs("div", { className: cn("relative flex-1 min-h-0", className), ...props, children: [_jsx("div", { ref: scrollRef, onScroll: onScroll, className: "h-full overflow-y-auto", children: children }), _jsx(ConversationScrollButton, {})] }) }));
}
export function ConversationContent({ className, children, ...props }) {
    return (_jsx("div", { className: cn("mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8", className), ...props, children: children }));
}
export function ConversationEmptyState({ title, description, icon, className, }) {
    return (_jsxs("div", { className: cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className), children: [icon && _jsx("div", { className: "text-muted-foreground", children: icon }), _jsx("h2", { className: "text-lg sm:text-xl font-semibold", children: title }), description && _jsx("p", { className: "text-sm text-muted-foreground max-w-md", children: description })] }));
}
function ConversationScrollButton() {
    const ctx = useConversation();
    if (!ctx || ctx.isAtBottom)
        return null;
    return (_jsx(Button, { size: "icon", variant: "outline", onClick: ctx.scrollToBottom, className: "absolute bottom-3 left-1/2 -translate-x-1/2 h-7 w-7 sm:h-8 sm:w-8 rounded-full shadow-md", children: _jsx(ArrowDown, { className: "h-3.5 w-3.5" }) }));
}
//# sourceMappingURL=conversation.js.map