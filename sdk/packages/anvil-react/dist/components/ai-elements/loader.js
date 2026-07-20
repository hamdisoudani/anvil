"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../lib/utils";
export function Loader({ size = 16, className, ...props }) {
    const dotSize = Math.max(4, Math.floor(size / 4));
    return (_jsx("div", { role: "status", "aria-label": "Loading", className: cn("inline-flex items-center gap-1", className), style: { height: size }, ...props, children: [0, 1, 2].map((i) => (_jsx("span", { className: "rounded-full bg-current animate-bounce", style: {
                width: dotSize,
                height: dotSize,
                animationDelay: `${i * 120}ms`,
                animationDuration: "800ms",
            } }, i))) }));
}
//# sourceMappingURL=loader.js.map