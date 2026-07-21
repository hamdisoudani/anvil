import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ErrorBanner — A severity-aware error display for Anvil agents.
 *
 * Renders structured AgentError objects with severity colors, code
 * badges, retry/dismiss actions, and collapsible raw payload details.
 *
 * shadcn+Tailwind only. Zero external dependencies beyond the project's
 * existing ui primitives (Badge, Button, cn).
 */
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { AlertCircle, AlertTriangle, Info, XCircle, ChevronDown, ChevronRight, RotateCw, X, } from "lucide-react";
// ── Severity config ──────────────────────────────────────────────
const SEVERITY_CONFIG = {
    info: {
        icon: Info,
        containerClass: "bg-blue-500/5",
        borderClass: "border-blue-500/40",
        textClass: "text-blue-600 dark:text-blue-400",
        badgeVariant: "default",
        label: "Info",
    },
    warning: {
        icon: AlertTriangle,
        containerClass: "bg-amber-500/5",
        borderClass: "border-amber-500/40",
        textClass: "text-amber-600 dark:text-amber-400",
        badgeVariant: "secondary",
        label: "Warning",
    },
    error: {
        icon: AlertCircle,
        containerClass: "bg-destructive/5",
        borderClass: "border-destructive/40",
        textClass: "text-destructive",
        badgeVariant: "destructive",
        label: "Error",
    },
    fatal: {
        icon: XCircle,
        containerClass: "bg-destructive/10",
        borderClass: "border-destructive/60",
        textClass: "text-destructive font-semibold",
        badgeVariant: "destructive",
        label: "Fatal",
    },
};
// ── Helpers ──────────────────────────────────────────────────────
function normalizeError(err) {
    if (typeof err === "string") {
        return { message: err, severity: "error" };
    }
    return {
        message: err.message ?? "An unknown error occurred",
        code: err.code,
        severity: err.severity ?? "error",
        recoverable: err.recoverable,
        retryable: err.retryable,
        stepId: err.stepId,
        raw: err.raw,
    };
}
// ── Component ────────────────────────────────────────────────────
export function ErrorBanner({ error, onRetry, onDismiss, className, }) {
    const [showDetails, setShowDetails] = useState(false);
    const err = normalizeError(error);
    const severity = err.severity ?? "error";
    const cfg = SEVERITY_CONFIG[severity];
    const Icon = cfg.icon;
    const hasRaw = err.raw !== undefined && err.raw !== null;
    const isRetryable = err.retryable === true && typeof onRetry === "function";
    return (_jsx("div", { role: "alert", className: cn("relative rounded-lg border p-3 text-sm", cfg.containerClass, cfg.borderClass, className), children: _jsxs("div", { className: "flex items-start gap-2.5", children: [_jsx(Icon, { className: cn("h-4 w-4 mt-0.5 shrink-0", cfg.textClass) }), _jsxs("div", { className: "flex-1 min-w-0 space-y-1", children: [_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsx("span", { className: cn("text-xs font-medium", cfg.textClass), children: cfg.label }), err.code && (_jsx(Badge, { variant: cfg.badgeVariant, className: "text-[10px] px-1.5 py-0 font-mono", children: err.code })), err.stepId && (_jsxs("span", { className: "text-[10px] text-muted-foreground font-mono", children: ["step: ", err.stepId] }))] }), _jsx("p", { className: "text-xs sm:text-sm text-foreground break-words", children: err.message }), hasRaw && (_jsxs("div", { className: "pt-0.5", children: [_jsxs("button", { type: "button", onClick: () => setShowDetails(!showDetails), className: "inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors", children: [showDetails ? (_jsx(ChevronDown, { className: "h-3 w-3" })) : (_jsx(ChevronRight, { className: "h-3 w-3" })), showDetails ? "Hide details" : "Show details"] }), showDetails && (_jsx("pre", { className: "mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[10px] text-muted-foreground font-mono whitespace-pre-wrap break-all", children: typeof err.raw === "string"
                                        ? err.raw
                                        : JSON.stringify(err.raw, null, 2) }))] }))] }), _jsxs("div", { className: "flex items-center gap-1 shrink-0", children: [isRetryable && (_jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: onRetry, title: "Retry", children: _jsx(RotateCw, { className: "h-3.5 w-3.5" }) })), typeof onDismiss === "function" && (_jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: onDismiss, title: "Dismiss", children: _jsx(X, { className: "h-3.5 w-3.5" }) }))] })] }) }));
}
//# sourceMappingURL=error-banner.js.map