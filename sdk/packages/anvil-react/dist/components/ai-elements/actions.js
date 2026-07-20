"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Actions — message-level action buttons (copy, retry, like).
 * Appears on hover, sticky to bottom of message.
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
export function Actions({ className, children, ...props }) {
    return (_jsx("div", { className: cn("flex items-center gap-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity", className), ...props, children: children }));
}
export function Action({ tooltip, label, icon: Icon, className, ...props }) {
    const [open, setOpen] = React.useState(false);
    return (_jsxs("div", { className: "relative", children: [_jsx(Button, { variant: "ghost", size: "icon", "aria-label": label, title: tooltip ?? label, onClick: () => setOpen(false), onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false), className: cn("h-6 w-6 sm:h-7 sm:w-7", className), ...props, children: _jsx(Icon, { className: "h-3 w-3 sm:h-3.5 sm:w-3.5" }) }), tooltip && open && (_jsx("div", { className: "absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] font-medium bg-popover text-popover-foreground border rounded shadow-sm pointer-events-none whitespace-nowrap z-10", children: tooltip }))] }));
}
//# sourceMappingURL=actions.js.map