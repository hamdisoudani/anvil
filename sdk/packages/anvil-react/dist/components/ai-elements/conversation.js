"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { cn } from "../../lib/utils";
import { ArrowDown } from "lucide-react";
import { Button } from "../ui/button";
const ConversationContext = React.createContext(null);
export function useConversation() {
    return React.useContext(ConversationContext);
}
const SCROLL_BOTTOM_THRESHOLD = 80; // px from bottom
export function Conversation({ className, children, ...props }) {
    const scrollRef = React.useRef(null);
    const contentRef = React.useRef(null);
    const isAtBottomRef = React.useRef(true);
    const [isAtBottom, setIsAtBottom] = React.useState(true);
    // Stable scroll callback — bound to refs, never changes identity.
    const scrollToBottom = React.useCallback((smooth = true) => {
        const el = scrollRef.current;
        if (!el)
            return;
        if (smooth) {
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }
        else {
            el.scrollTop = el.scrollHeight;
        }
    }, []);
    // Public API exposed to consumers via context — wrap to ignore arg.
    const scrollToBottomPublic = React.useCallback(() => scrollToBottom(true), [scrollToBottom]);
    const onScroll = React.useCallback(() => {
        const el = scrollRef.current;
        if (!el)
            return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD;
        isAtBottomRef.current = atBottom;
        // Only commit a React rerender when the value actually flips. Scroll
        // events fire continuously during streaming — skipping no-op updates
        // is the single biggest perf win for this component.
        setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
    }, []);
    // Stick-to-bottom on content resize while at-bottom. ResizeObserver
    // tracks the content node directly, so we don't need to depend on
    // `children` (which changes every streamed token). Depending on
    // children would tear down the observer on every keystroke.
    React.useEffect(() => {
        const content = contentRef.current;
        const scroller = scrollRef.current;
        if (!content || !scroller)
            return;
        const stick = () => {
            if (isAtBottomRef.current) {
                scroller.scrollTop = scroller.scrollHeight;
            }
        };
        // Initial stick (children already mounted).
        stick();
        const ro = new ResizeObserver(stick);
        ro.observe(content);
        return () => ro.disconnect();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Memoized context value — only changes when isAtBottom flips.
    const ctxValue = React.useMemo(() => ({ isAtBottom, scrollToBottom: scrollToBottomPublic }), [isAtBottom, scrollToBottomPublic]);
    return (_jsx(ConversationContext.Provider, { value: ctxValue, children: _jsxs("div", { className: cn("relative flex-1 min-h-0", className), ...props, children: [_jsx("div", { ref: scrollRef, onScroll: onScroll, className: "h-full overflow-y-auto overscroll-contain", children: _jsx("div", { ref: contentRef, children: children }) }), _jsx(ConversationScrollButton, {})] }) }));
}
export const ConversationContent = React.memo(function ConversationContent({ className, children, ...props }) {
    return (_jsx("div", { className: cn("mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8", className), ...props, children: children }));
});
export const ConversationEmptyState = React.memo(function ConversationEmptyState({ title, description, icon, className, }) {
    return (_jsxs("div", { className: cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className), children: [icon && _jsx("div", { className: "text-muted-foreground", children: icon }), _jsx("h2", { className: "text-lg sm:text-xl font-semibold", children: title }), description && (_jsx("p", { className: "text-sm text-muted-foreground max-w-md", children: description }))] }));
});
const ConversationScrollButton = React.memo(function ConversationScrollButton() {
    const ctx = useConversation();
    if (!ctx || ctx.isAtBottom)
        return null;
    return (_jsx(Button, { size: "icon", variant: "outline", onClick: ctx.scrollToBottom, className: "absolute bottom-3 left-1/2 -translate-x-1/2 h-7 w-7 sm:h-8 sm:w-8 rounded-full shadow-md", children: _jsx(ArrowDown, { className: "h-3.5 w-3.5" }) }));
});
//# sourceMappingURL=conversation.js.map