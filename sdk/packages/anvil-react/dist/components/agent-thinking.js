import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AgentThinking — A generic real-time agent thinking display.
 *
 * Shows the agent's internal process as it happens:
 * - Phase transitions with icons + activity text
 * - Step-by-step timeline (collapsible)
 * - Sources discovered in real-time
 * - Plan preview (sub-queries, reasoning)
 *
 * Works with ANY Anvil agent. Just pass the events array
 * and it handles the rest.
 */
import { useState } from "react";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { useAgentState, } from "@anvil/react-headless";
import { ErrorBanner } from "./ai-elements/error-banner";
import { Search, Globe, BookOpen, Pencil, CheckCircle2, XCircle, Loader2, ChevronRight, } from "lucide-react";
// ── Phase icons ──────────────────────────────────────────────────
const PHASE_ICONS = {
    idle: Loader2,
    planning: Search,
    searching: Globe,
    reading: BookOpen,
    writing: Pencil,
    done: CheckCircle2,
    error: XCircle,
};
const PHASE_LABELS = {
    idle: "Idle",
    planning: "Planning",
    searching: "Searching",
    reading: "Reading",
    writing: "Writing",
    done: "Done",
    error: "Error",
};
function getActivity(state) {
    const lastStep = state.planSteps[state.currentStepIndex];
    if (lastStep?.status === "running") {
        return lastStep.intent + (lastStep.detail ? `: ${lastStep.detail}` : "");
    }
    if (state.isStreaming)
        return "Writing answer…";
    if (state.phase === "done")
        return "Done";
    if (state.phase === "error")
        return state.error?.message ?? "Error";
    return PHASE_LABELS[state.phase] ?? state.phase;
}
export function AgentThinking({ events, defaultExpanded = false, className, compact = false, }) {
    const state = useAgentState({ sharedEvents: events });
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [showSteps, setShowSteps] = useState(false);
    const [showSources, setShowSources] = useState(false);
    if (state.phase === "idle")
        return null;
    const Icon = PHASE_ICONS[state.phase];
    const isActive = state.phase !== "done" && state.phase !== "error";
    const activity = getActivity(state);
    const containerClass = compact
        ? cn("flex flex-col gap-1", className)
        : cn("rounded-lg border bg-card p-3 sm:p-4 space-y-3", className);
    return (_jsxs("div", { className: containerClass, children: [_jsxs("button", { type: "button", onClick: () => setExpanded(!expanded), className: "w-full flex items-center gap-3 text-left", children: [_jsx("div", { className: cn("flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full shrink-0", isActive
                            ? "bg-primary/10 text-primary"
                            : state.phase === "error"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-muted text-muted-foreground"), children: _jsx(Icon, { className: cn("h-3 sm:h-3.5 w-3 sm:w-3.5", isActive && "animate-spin") }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-xs sm:text-sm font-medium truncate", children: activity }), _jsxs("div", { className: "text-[10px] sm:text-xs text-muted-foreground", children: [PHASE_LABELS[state.phase], state.plan && Array.isArray(state.plan.sub_queries) && state.plan.sub_queries.length > 0 && (_jsxs("span", { children: [" \u00B7 ", state.plan.sub_queries.length, " queries"] })), state.sources.length > 0 && (_jsxs("span", { children: [" \u00B7 ", state.sources.length, " sources"] })), state.pagesRead > 0 && (_jsxs("span", { children: [" \u00B7 ", state.pagesRead, " pages read"] }))] })] }), _jsx(ChevronRight, { className: cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", expanded && "rotate-90") })] }), expanded && (_jsxs("div", { className: "space-y-3 pt-2 border-t", children: [state.plan && Array.isArray(state.plan.sub_queries) && state.plan.sub_queries.length > 0 && (_jsxs("div", { className: "space-y-2", children: [state.plan.reason && (_jsxs("div", { className: "rounded-md bg-muted/40 px-2.5 py-2", children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1", children: "Plan" }), _jsx("p", { className: "text-xs sm:text-sm text-foreground/90 leading-relaxed", children: String(state.plan.reason) }), state.plan.synthesize_hint && (_jsxs("p", { className: "mt-1.5 text-[11px] text-muted-foreground", children: ["Answer style: ", String(state.plan.synthesize_hint)] }))] })), _jsxs("div", { className: "space-y-1.5", children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground", children: "Search queries" }), _jsx("ul", { className: "space-y-1.5", children: state.plan.sub_queries.map((q, i) => (_jsxs("li", { className: "flex flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2.5 py-2", children: [_jsxs("div", { className: "flex items-center gap-1.5 flex-wrap", children: [_jsx("span", { className: "text-[10px] font-mono text-muted-foreground", children: String(q.id ?? `q${i + 1}`) }), q.source && (_jsx(Badge, { variant: "outline", className: "text-[9px] h-4 px-1.5", children: String(q.source) })), q.year ? (_jsx(Badge, { variant: "secondary", className: "text-[9px] h-4 px-1.5", children: String(q.year) })) : null] }), _jsx("p", { className: "text-xs sm:text-sm font-medium leading-snug break-words", children: String(q.query || q.intent || "") }), q.intent && q.query && q.intent !== q.query && (_jsx("p", { className: "text-[11px] text-muted-foreground break-words", children: String(q.intent) }))] }, q.id ?? i))) })] })] })), state.sources.length > 0 && (_jsxs("div", { className: "space-y-1.5", children: [_jsxs("button", { type: "button", onClick: () => setShowSources(!showSources), className: "flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground", children: [_jsx(ChevronRight, { className: cn("h-3 w-3 transition-transform", showSources && "rotate-90") }), "Sources (", state.sources.length, ")"] }), showSources && (_jsx("div", { className: "grid grid-cols-1 gap-1", children: state.sources.map((s) => (_jsxs("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", className: "flex items-center gap-2 p-1.5 rounded hover:bg-accent/30 text-[10px] sm:text-xs", children: [_jsx(Badge, { variant: "outline", className: "h-4 px-1 text-[9px] font-mono shrink-0", children: s.id }), _jsx("span", { className: "truncate", children: s.title }), _jsx("span", { className: "text-muted-foreground truncate hidden sm:inline", children: s.domain })] }, s.id))) }))] })), state.planSteps.length > 0 && (_jsxs("div", { className: "space-y-1.5", children: [_jsxs("button", { type: "button", onClick: () => setShowSteps(!showSteps), className: "flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground", children: [_jsx(ChevronRight, { className: cn("h-3 w-3 transition-transform", showSteps && "rotate-90") }), "Steps (", state.planSteps.length, ")"] }), showSteps && (_jsx("div", { className: "space-y-0.5 pl-2 border-l-2 border-muted", children: state.planSteps.map((step, i) => (_jsxs("div", { className: "flex items-center gap-2 py-0.5 text-[10px] sm:text-xs", children: [_jsx("div", { className: cn("w-1.5 h-1.5 rounded-full shrink-0", step.status === "running"
                                                ? "bg-primary animate-pulse"
                                                : step.status === "done"
                                                    ? "bg-green-500"
                                                    : step.status === "error"
                                                        ? "bg-destructive"
                                                        : "bg-muted-foreground") }), _jsxs("span", { className: cn("truncate", step.status === "running"
                                                ? "font-medium"
                                                : "text-muted-foreground"), children: [step.intent, step.detail ? `: ${step.detail}` : ""] }), step.status === "done" && (_jsx(CheckCircle2, { className: "h-3 w-3 text-green-500 shrink-0" }))] }, i))) }))] })), state.error && (_jsx(ErrorBanner, { error: state.error, className: "mt-2" }))] }))] }));
}
export function AgentThinkingInline({ events }) {
    const state = useAgentState({ sharedEvents: events });
    if (state.phase === "idle")
        return null;
    return (_jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader2, { className: "h-3 w-3 animate-spin" }), _jsx("span", { children: getActivity(state) })] }));
}
export { useAgentState } from "@anvil/react-headless";
//# sourceMappingURL=agent-thinking.js.map