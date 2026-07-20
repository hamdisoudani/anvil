"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Sources — collapsible citation list.
 *
 * Default: collapsed, shows "N sources" trigger.
 * Opens to show a list of <Source> items with title + domain.
 * Auto-opens when `autoOpen` is true (use this for completed assistant turns).
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { ChevronRight, ExternalLink } from "lucide-react";
const SourcesContext = React.createContext(null);
function useSources() {
    const ctx = React.useContext(SourcesContext);
    return ctx ?? { autoOpen: false };
}
export function Sources({ autoOpen = false, defaultOpen, className, children, ...props }) {
    const [open, setOpen] = React.useState(defaultOpen ?? autoOpen);
    // Re-sync when autoOpen flips (track direction with a ref)
    const prevAutoOpen = React.useRef(autoOpen);
    React.useEffect(() => {
        if (prevAutoOpen.current !== autoOpen) {
            setOpen(autoOpen);
            prevAutoOpen.current = autoOpen;
        }
    }, [autoOpen]);
    return (_jsx(SourcesContext.Provider, { value: { autoOpen }, children: _jsx("div", { className: cn("mt-2", className), ...props, children: React.Children.map(children, (child) => {
                if (React.isValidElement(child) && child.type === SourcesTrigger) {
                    return React.cloneElement(child, {
                        open,
                        onOpenChange: setOpen,
                    });
                }
                if (React.isValidElement(child) && child.type === SourcesContent) {
                    return React.cloneElement(child, { open });
                }
                return child;
            }) }) }));
}
export function SourcesTrigger({ open, onOpenChange, count, className, ...props }) {
    return (_jsxs("button", { type: "button", onClick: () => onOpenChange?.(!open), className: cn("inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-medium text-muted-foreground hover:text-foreground transition-colors", className), ...props, children: [_jsx(ChevronRight, { className: cn("h-3 w-3 transition-transform", open && "rotate-90") }), count !== undefined ? `${count} source${count === 1 ? "" : "s"}` : "Sources"] }));
}
export function SourcesContent({ open, className, children, ...props }) {
    if (!open)
        return null;
    return (_jsx("div", { className: cn("mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1 pl-2 border-l-2 border-muted", className), ...props, children: children }));
}
export function Source({ href, title, domain, className, children, ...props }) {
    const displayTitle = title ?? children ?? href;
    const inferredDomain = React.useMemo(() => {
        if (domain)
            return domain;
        try {
            return new URL(href).hostname.replace(/^www\./, "");
        }
        catch {
            return href;
        }
    }, [domain, href]);
    return (_jsxs("a", { href: href, target: "_blank", rel: "noopener noreferrer", className: cn("group flex items-start gap-1.5 rounded px-1.5 py-1 text-[10px] sm:text-xs hover:bg-accent/40 transition-colors", className), ...props, children: [_jsx(ExternalLink, { className: "h-3 w-3 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground" }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "truncate font-medium", children: displayTitle }), _jsx("div", { className: "truncate text-muted-foreground text-[9px] sm:text-[10px]", children: inferredDomain })] })] }));
}
//# sourceMappingURL=sources.js.map