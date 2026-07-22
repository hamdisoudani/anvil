"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Reasoning — collapsible agent thinking display.
 *
 * Behavior matches AI Elements: opens by default when streaming,
 * auto-collapses when isStreaming becomes false.
 *
 * Performance notes:
 *  - Auto-open / auto-collapse is derived from props (no mirror state
 *    and no effect) — eliminates an extra commit on every streaming flip.
 *  - Context value is memoized so consumers don't re-render unless
 *    `open` actually changes (clicking the trigger vs parent rerender).
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { ChevronRight, Brain } from "lucide-react";
export function Reasoning({ isStreaming = false, defaultOpen = true, className, children, ...props }) {
    // Auto-open while streaming. Click override sticks (sticky user intent).
    const [userOpen, setUserOpen] = React.useState(null);
    const open = userOpen ?? (isStreaming || defaultOpen);
    const setOpen = React.useCallback((o) => setUserOpen(o), []);
    // Memoized context — only changes when `open` flips. Consumers reading
    // `isStreaming` won't re-render just because the parent rerendered.
    const ctx = React.useMemo(() => ({ open, setOpen, isStreaming }), [open, setOpen, isStreaming]);
    return (_jsx(ReasoningContext.Provider, { value: ctx, children: _jsx("div", { className: cn("my-2 border border-muted/60 rounded-lg overflow-hidden", className), ...props, children: children }) }));
}
const ReasoningContext = React.createContext(null);
function useReasoning() {
    const ctx = React.useContext(ReasoningContext);
    if (!ctx)
        throw new Error("useReasoning must be inside <Reasoning>");
    return ctx;
}
export function ReasoningTrigger({ title = "Reasoning", className, ...props }) {
    const { open, setOpen, isStreaming } = useReasoning();
    return (_jsxs("button", { type: "button", onClick: () => setOpen(!open), className: cn("w-full flex items-center gap-2 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors", className), ...props, children: [_jsx(Brain, { className: cn("h-3 w-3 shrink-0", isStreaming && "animate-pulse text-primary") }), _jsxs("span", { className: "flex-1 text-left truncate", children: [title, isStreaming && (_jsx("span", { className: "ml-1.5 text-primary", children: "\u00B7 thinking\u2026" }))] }), _jsx(ChevronRight, { className: cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90") })] }));
}
export const ReasoningContent = React.memo(function ReasoningContent({ className, children, ...props }) {
    const { open } = useReasoning();
    if (!open)
        return null;
    return (_jsx("div", { className: cn("px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs text-muted-foreground border-t border-muted/60 bg-muted/10 max-h-60 overflow-y-auto", className), ...props, children: children }));
});
//# sourceMappingURL=reasoning.js.map