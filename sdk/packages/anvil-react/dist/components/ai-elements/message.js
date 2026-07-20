"use client";
import { jsx as _jsx } from "react/jsx-runtime";
/**
 * AI Elements-style Message components.
 *
 * Self-contained, shadcn-based. No external deps.
 *
 * Usage:
 *   <Message from="user">
 *     <MessageAvatar name="You" />
 *     <MessageContent>{text}</MessageContent>
 *   </Message>
 *   <Message from="assistant">
 *     <MessageAvatar name="AI" />
 *     <MessageContent variant="contained">
 *       <Response>{text}</Response>
 *     </MessageContent>
 *   </Message>
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { Avatar, AvatarFallback } from "../ui/avatar";
const MessageContext = React.createContext(null);
function useMessage() {
    const ctx = React.useContext(MessageContext);
    if (!ctx)
        throw new Error("useMessage must be used within <Message>");
    return ctx;
}
export function Message({ from, className, children, ...props }) {
    return (_jsx(MessageContext.Provider, { value: { from }, children: _jsx("div", { className: cn("group flex w-full items-start gap-2 sm:gap-3 py-2 sm:py-3", from === "user" && "flex-row-reverse", className), ...props, children: children }) }));
}
export function MessageContent({ variant = "contained", className, children, ...props }) {
    const { from } = useMessage();
    return (_jsx("div", { className: cn("flex-1 min-w-0 text-sm leading-relaxed", from === "user" && "max-w-[85%] sm:max-w-[75%]", variant === "contained" &&
            cn("rounded-2xl px-3 sm:px-4 py-2 sm:py-3", from === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50"), variant === "flat" && "py-1", className), ...props, children: children }));
}
export function MessageAvatar({ name, className }) {
    const { from } = useMessage();
    const initials = name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    return (_jsx(Avatar, { className: cn("h-7 w-7 sm:h-8 sm:w-8 shrink-0", className), children: _jsx(AvatarFallback, { className: cn("text-[10px] sm:text-xs font-medium", from === "user"
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"), children: initials || (from === "user" ? "U" : "AI") }) }));
}
//# sourceMappingURL=message.js.map