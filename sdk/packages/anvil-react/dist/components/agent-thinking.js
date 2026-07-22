"use client";
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
 *
 * Performance notes:
 *  - useAgentState is memoized at the hook layer (recomputes the
 *    full state from the event log only when the events array
 *    reference changes — which is what we want).
 *  - Derived view-model (plan sub-queries, activity, phase icon)
 *    is built ONCE per render via useMemo, then handed down to
 *    pure child components via memoized prop objects.
 *  - Sections that don't depend on frequently-changing data
 *    (sources list, step timeline) are React.memo'd and key off
 *    their data — they won't rerender unless their slice changes.
 *  - The header (phase icon + activity text) IS expected to
 *    rerender every event — that's the whole point — but it
 *    uses derived state only (no `(state.plan as any)` casts).
 *  - Stable callback refs prevent the inline `<button onClick>`
 *    triggers from changing identity every render.
 */
import * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { useAgentState, } from "@anvil/react-headless";
import { ErrorBanner } from "./ai-elements/error-banner";
import { Search, Globe, BookOpen, Pencil, CheckCircle2, XCircle, Loader2, ChevronRight, } from "lucide-react";
const PHASE_ICONS = Object.freeze({
    idle: Loader2,
    planning: Search,
    searching: Globe,
    reading: BookOpen,
    writing: Pencil,
    done: CheckCircle2,
    error: XCircle,
});
const PHASE_LABELS = Object.freeze({
    idle: "Idle",
    planning: "Planning",
    searching: "Searching",
    reading: "Reading",
    writing: "Writing",
    done: "Done",
    error: "Error",
});
/** Fallback for phases we don't know (forward-compat). */
const FALLBACK_ICON = Loader2;
const FALLBACK_LABEL = "Working";
function getActivity(state) {
    // `currentStepIndex` is the last received plan.step. If it's still
    // "running", surface that intent as the live activity.
    const lastStep = state.currentStepIndex >= 0 ? state.planSteps[state.currentStepIndex] : null;
    if (lastStep && lastStep.status === "running") {
        return lastStep.detail
            ? `${lastStep.intent}: ${lastStep.detail}`
            : lastStep.intent;
    }
    if (state.isStreaming)
        return "Writing answer…";
    if (state.phase === "done")
        return "Done";
    if (state.phase === "error")
        return state.error?.message ?? "Error";
    return PHASE_LABELS[state.phase] ?? FALLBACK_LABEL;
}
function buildView(state) {
    // Strongly typed reads of AgentPlan fields. AgentPlan already has
    // `sub_queries?: PlanSubQuery[]` etc. — no `as any` casts needed.
    const plan = state.plan;
    const subQueries = plan?.sub_queries;
    return {
        phase: state.phase,
        Icon: PHASE_ICONS[state.phase] ?? FALLBACK_ICON,
        isActive: state.phase !== "done" && state.phase !== "error",
        activity: getActivity(state),
        phaseLabel: PHASE_LABELS[state.phase] ?? FALLBACK_LABEL,
        subQueryCount: Array.isArray(subQueries) ? subQueries.length : 0,
        sourceCount: state.sources.length,
        pagesRead: state.pagesRead,
        plan,
        sources: state.sources,
        planSteps: state.planSteps,
        error: state.error,
    };
}
export const AgentThinking = React.memo(function AgentThinking({ events, defaultExpanded = false, className, compact = false, }) {
    const state = useAgentState({ sharedEvents: events });
    const [expanded, setExpanded] = React.useState(defaultExpanded);
    const [showSteps, setShowSteps] = React.useState(false);
    const [showSources, setShowSources] = React.useState(false);
    // Build the view-model once. If the underlying `state` reference
    // is stable (the hook memoizes it), `view` is too.
    const view = React.useMemo(() => buildView(state), [state]);
    // Stable callbacks — identity never changes across renders unless
    // their state setter changes (which it never does for useState).
    const onToggleExpanded = React.useCallback(() => setExpanded((v) => !v), []);
    const onToggleSteps = React.useCallback(() => setShowSteps((v) => !v), []);
    const onToggleSources = React.useCallback(() => setShowSources((v) => !v), []);
    if (view.phase === "idle")
        return null;
    return (_jsx(AgentThinkingShell, { className: className, compact: compact, expanded: expanded, onToggleExpanded: onToggleExpanded, view: view, children: expanded && (_jsx(ExpandedBody, { view: view, showSteps: showSteps, showSources: showSources, onToggleSteps: onToggleSteps, onToggleSources: onToggleSources })) }));
});
const AgentThinkingShell = React.memo(function AgentThinkingShell({ className, compact, expanded, onToggleExpanded, view, children, }) {
    const containerClass = compact
        ? cn("flex flex-col gap-1", className)
        : cn("rounded-lg border bg-card p-3 sm:p-4 space-y-3", className);
    return (_jsxs("div", { className: containerClass, children: [_jsxs("button", { type: "button", onClick: onToggleExpanded, className: "w-full flex items-center gap-3 text-left", children: [_jsx(PhaseIndicator, { view: view }), _jsx(PhaseSummary, { view: view }), _jsx(ChevronRight, { className: cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", expanded && "rotate-90") })] }), children] }));
});
const PhaseIndicator = React.memo(function PhaseIndicator({ view, }) {
    const { Icon, isActive, phase } = view;
    return (_jsx("div", { className: cn("flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full shrink-0", isActive
            ? "bg-primary/10 text-primary"
            : phase === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"), children: _jsx(Icon, { className: cn("h-3 sm:h-3.5 w-3 sm:w-3.5", isActive && "animate-spin") }) }));
});
const PhaseSummary = React.memo(function PhaseSummary({ view, }) {
    return (_jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-xs sm:text-sm font-medium truncate", children: view.activity }), _jsx(SummaryMeta, { view: view })] }));
});
const SummaryMeta = React.memo(function SummaryMeta({ view, }) {
    // Only show the meta line when there's something to say. Saves a
    // line of vertical space and an empty `<div>` on idle frames.
    const hasMeta = view.subQueryCount > 0 ||
        view.sourceCount > 0 ||
        view.pagesRead > 0 ||
        view.phase !== "done"; // always show phase label for active phases
    if (!hasMeta)
        return null;
    return (_jsxs("div", { className: "text-[10px] sm:text-xs text-muted-foreground", children: [view.phaseLabel, view.subQueryCount > 0 && (_jsxs("span", { children: [" \u00B7 ", view.subQueryCount, " queries"] })), view.sourceCount > 0 && (_jsxs("span", { children: [" \u00B7 ", view.sourceCount, " sources"] })), view.pagesRead > 0 && _jsxs("span", { children: [" \u00B7 ", view.pagesRead, " pages read"] })] }));
});
const ExpandedBody = React.memo(function ExpandedBody({ view, showSteps, showSources, onToggleSteps, onToggleSources, }) {
    return (_jsxs("div", { className: "space-y-3 pt-2 border-t", children: [_jsx(PlanSection, { plan: view.plan }), _jsx(SourcesSection, { sources: view.sources, expanded: showSources, onToggle: onToggleSources }), _jsx(StepsSection, { steps: view.planSteps, expanded: showSteps, onToggle: onToggleSteps }), view.error && _jsx(ErrorBanner, { error: view.error, className: "mt-2" })] }));
});
// ── Plan section ────────────────────────────────────────────────────
const PlanSection = React.memo(function PlanSection({ plan, }) {
    if (!plan)
        return null;
    const subQueries = plan.sub_queries;
    const hasSubQueries = Array.isArray(subQueries) && subQueries.length > 0;
    const hasReason = typeof plan.reason === "string" && plan.reason.length > 0;
    const hasSynthHint = typeof plan.synthesize_hint === "string" && plan.synthesize_hint.length > 0;
    if (!hasSubQueries && !hasReason)
        return null;
    return (_jsxs("div", { className: "space-y-2", children: [hasReason && (_jsxs("div", { className: "rounded-md bg-muted/40 px-2.5 py-2", children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1", children: "Plan" }), _jsx("p", { className: "text-xs sm:text-sm text-foreground/90 leading-relaxed", children: plan.reason }), hasSynthHint && (_jsxs("p", { className: "mt-1.5 text-[11px] text-muted-foreground", children: ["Answer style: ", plan.synthesize_hint] }))] })), hasSubQueries && _jsx(SubQueryList, { queries: subQueries })] }));
});
const SubQueryList = React.memo(function SubQueryList({ queries, }) {
    return (_jsxs("div", { className: "space-y-1.5", children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground", children: "Search queries" }), _jsx("ul", { className: "space-y-1.5", children: queries.map((q, i) => (_jsx(SubQueryRow, { query: q, index: i }, q.id ?? `q${i}`))) })] }));
});
const SubQueryRow = React.memo(function SubQueryRow({ query, index, }) {
    const intent = String(query.intent ?? "");
    const qText = String(query.query ?? "");
    const showIntent = intent && qText && intent !== qText;
    const idLabel = String(query.id ?? `q${index + 1}`);
    return (_jsxs("li", { className: "flex flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2.5 py-2", children: [_jsxs("div", { className: "flex items-center gap-1.5 flex-wrap", children: [_jsx("span", { className: "text-[10px] font-mono text-muted-foreground", children: idLabel }), query.source && (_jsx(Badge, { variant: "outline", className: "text-[9px] h-4 px-1.5", children: String(query.source) })), query.year != null && (_jsx(Badge, { variant: "secondary", className: "text-[9px] h-4 px-1.5", children: String(query.year) }))] }), _jsx("p", { className: "text-xs sm:text-sm font-medium leading-snug break-words", children: qText || intent }), showIntent && (_jsx("p", { className: "text-[11px] text-muted-foreground break-words", children: intent }))] }));
});
const SourcesSection = React.memo(function SourcesSection({ sources, expanded, onToggle, }) {
    if (sources.length === 0)
        return null;
    return (_jsxs("div", { className: "space-y-1.5", children: [_jsxs("button", { type: "button", onClick: onToggle, className: "flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground", children: [_jsx(ChevronRight, { className: cn("h-3 w-3 transition-transform", expanded && "rotate-90") }), "Sources (", sources.length, ")"] }), expanded && (_jsx("div", { className: "grid grid-cols-1 gap-1", children: sources.map((s) => (_jsx(SourceRow, { source: s }, s.id))) }))] }));
});
const SourceRow = React.memo(function SourceRow({ source, }) {
    return (_jsxs("a", { href: source.url, target: "_blank", rel: "noopener noreferrer", className: "flex items-center gap-2 p-1.5 rounded hover:bg-accent/30 text-[10px] sm:text-xs", children: [_jsx(Badge, { variant: "outline", className: "h-4 px-1 text-[9px] font-mono shrink-0", children: source.id }), _jsx("span", { className: "truncate", children: source.title }), _jsx("span", { className: "text-muted-foreground truncate hidden sm:inline", children: source.domain })] }));
});
const StepsSection = React.memo(function StepsSection({ steps, expanded, onToggle, }) {
    if (steps.length === 0)
        return null;
    return (_jsxs("div", { className: "space-y-1.5", children: [_jsxs("button", { type: "button", onClick: onToggle, className: "flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground", children: [_jsx(ChevronRight, { className: cn("h-3 w-3 transition-transform", expanded && "rotate-90") }), "Steps (", steps.length, ")"] }), expanded && (_jsx("ol", { className: "space-y-0.5 pl-2 border-l-2 border-muted", children: steps.map((step, i) => (_jsx(StepRow, { step: step }, i))) }))] }));
});
const StepRow = React.memo(function StepRow({ step, }) {
    const isRunning = step.status === "running";
    const isDone = step.status === "done";
    const isError = step.status === "error";
    return (_jsxs("li", { className: "flex items-center gap-2 py-0.5 text-[10px] sm:text-xs", children: [_jsx("div", { className: cn("w-1.5 h-1.5 rounded-full shrink-0", isRunning
                    ? "bg-primary animate-pulse"
                    : isDone
                        ? "bg-green-500"
                        : isError
                            ? "bg-destructive"
                            : "bg-muted-foreground") }), _jsxs("span", { className: cn("truncate", isRunning ? "font-medium" : "text-muted-foreground"), children: [step.intent, step.detail ? `: ${step.detail}` : ""] }), isDone && _jsx(CheckCircle2, { className: "h-3 w-3 text-green-500 shrink-0" })] }));
});
// ── Inline variant (compact) ────────────────────────────────────────
export const AgentThinkingInline = React.memo(function AgentThinkingInline({ events, }) {
    const state = useAgentState({ sharedEvents: events });
    if (state.phase === "idle")
        return null;
    return (_jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader2, { className: "h-3 w-3 animate-spin" }), _jsx("span", { children: getActivity(state) })] }));
});
export { useAgentState } from "@anvil/react-headless";
//# sourceMappingURL=agent-thinking.js.map