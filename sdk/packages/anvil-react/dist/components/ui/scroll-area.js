import { jsx as _jsx } from "react/jsx-runtime";
// shadcn/ui-style ScrollArea component.
import * as React from "react";
import { cn } from "../../lib/utils";
const ScrollArea = React.forwardRef(({ className, children, ...props }, ref) => (_jsx("div", { ref: ref, className: cn("relative overflow-y-auto overflow-x-hidden", className), ...props, children: children })));
ScrollArea.displayName = "ScrollArea";
export { ScrollArea };
//# sourceMappingURL=scroll-area.js.map