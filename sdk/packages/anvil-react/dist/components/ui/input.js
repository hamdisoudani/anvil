import { jsx as _jsx } from "react/jsx-runtime";
// shadcn/ui-style Textarea, Input, Separator.
import * as React from "react";
import { cn } from "../../lib/utils";
const Textarea = React.forwardRef(({ className, ...props }, ref) => (_jsx("textarea", { ref: ref, className: cn("flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", className), ...props })));
Textarea.displayName = "Textarea";
export { Textarea };
export const Input = React.forwardRef(({ className, type, ...props }, ref) => (_jsx("input", { type: type, ref: ref, className: cn("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", className), ...props })));
Input.displayName = "Input";
export function Separator({ className, orientation = "horizontal" }) {
    return (_jsx("div", { role: "separator", className: cn("shrink-0 bg-border", orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]", className) }));
}
//# sourceMappingURL=input.js.map