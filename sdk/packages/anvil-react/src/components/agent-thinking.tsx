"use client";

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
import {
  AgentState,
  AgentPhase,
  PlanSubQuery,
  useAgentState,
} from "@anvil/react-headless";
import type { AnvilEvent } from "@anvil/client";
import { ErrorBanner } from "./ai-elements/error-banner";
import {
  Search,
  Globe,
  BookOpen,
  Pencil,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
} from "lucide-react";
import type { ComponentType } from "react";

// ── Phase metadata (module-scope, frozen, no per-render allocation) ──

type PhaseIcon = ComponentType<{ className?: string }>;

const PHASE_ICONS: Record<AgentPhase, PhaseIcon> = Object.freeze({
  idle: Loader2,
  planning: Search,
  searching: Globe,
  reading: BookOpen,
  writing: Pencil,
  done: CheckCircle2,
  error: XCircle,
});

const PHASE_LABELS: Record<AgentPhase, string> = Object.freeze({
  idle: "Idle",
  planning: "Planning",
  searching: "Searching",
  reading: "Reading",
  writing: "Writing",
  done: "Done",
  error: "Error",
});

/** Fallback for phases we don't know (forward-compat). */
const FALLBACK_ICON: PhaseIcon = Loader2;
const FALLBACK_LABEL: string = "Working";

function getActivity(state: AgentState): string {
  // `currentStepIndex` is the last received plan.step. If it's still
  // "running", surface that intent as the live activity.
  const lastStep =
    state.currentStepIndex >= 0 ? state.planSteps[state.currentStepIndex] : null;
  if (lastStep && lastStep.status === "running") {
    return lastStep.detail
      ? `${lastStep.intent}: ${lastStep.detail}`
      : lastStep.intent;
  }
  if (state.isStreaming) return "Writing answer…";
  if (state.phase === "done") return "Done";
  if (state.phase === "error") return state.error?.message ?? "Error";
  return PHASE_LABELS[state.phase] ?? FALLBACK_LABEL;
}

// ── View-model: derive once per render, pass to memoized children ────

interface AgentThinkingView {
  phase: AgentPhase;
  Icon: PhaseIcon;
  isActive: boolean;
  activity: string;
  phaseLabel: string;
  subQueryCount: number;
  sourceCount: number;
  pagesRead: number;
  plan: AgentState["plan"];
  sources: AgentState["sources"];
  planSteps: AgentState["planSteps"];
  error: AgentState["error"];
}

function buildView(state: AgentState): AgentThinkingView {
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

// ── Props / main component ─────────────────────────────────────────

export interface AgentThinkingProps {
  /** Event stream from the agent (sharedEvents or useEvents result) */
  events: AnvilEvent[];
  /** Optional: show the full step timeline expanded by default */
  defaultExpanded?: boolean;
  /** Optional: CSS class */
  className?: string;
  /** Optional: compact mode (inline, no card borders) */
  compact?: boolean;
}

export const AgentThinking = React.memo(function AgentThinking({
  events,
  defaultExpanded = false,
  className,
  compact = false,
}: AgentThinkingProps) {
  const state = useAgentState({ sharedEvents: events });
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [showSteps, setShowSteps] = React.useState(false);
  const [showSources, setShowSources] = React.useState(false);

  // Build the view-model once. If the underlying `state` reference
  // is stable (the hook memoizes it), `view` is too.
  const view = React.useMemo(() => buildView(state), [state]);

  // Stable callbacks — identity never changes across renders unless
  // their state setter changes (which it never does for useState).
  const onToggleExpanded = React.useCallback(
    () => setExpanded((v) => !v),
    [],
  );
  const onToggleSteps = React.useCallback(
    () => setShowSteps((v) => !v),
    [],
  );
  const onToggleSources = React.useCallback(
    () => setShowSources((v) => !v),
    [],
  );

  if (view.phase === "idle") return null;

  return (
    <AgentThinkingShell
      className={className}
      compact={compact}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      view={view}
    >
      {expanded && (
        <ExpandedBody
          view={view}
          showSteps={showSteps}
          showSources={showSources}
          onToggleSteps={onToggleSteps}
          onToggleSources={onToggleSources}
        />
      )}
    </AgentThinkingShell>
  );
});

// ── Memoized sub-components (each isolates its own rerender scope) ──

interface AgentThinkingShellProps {
  className?: string;
  compact: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  view: AgentThinkingView;
  children: React.ReactNode;
}

const AgentThinkingShell = React.memo(function AgentThinkingShell({
  className,
  compact,
  expanded,
  onToggleExpanded,
  view,
  children,
}: AgentThinkingShellProps) {
  const containerClass = compact
    ? cn("flex flex-col gap-1", className)
    : cn("rounded-lg border bg-card p-3 sm:p-4 space-y-3", className);

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-3 text-left"
      >
        <PhaseIndicator view={view} />
        <PhaseSummary view={view} />
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-90",
          )}
        />
      </button>
      {children}
    </div>
  );
});

const PhaseIndicator = React.memo(function PhaseIndicator({
  view,
}: {
  view: AgentThinkingView;
}) {
  const { Icon, isActive, phase } = view;
  return (
    <div
      className={cn(
        "flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full shrink-0",
        isActive
          ? "bg-primary/10 text-primary"
          : phase === "error"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
    >
      <Icon
        className={cn("h-3 sm:h-3.5 w-3 sm:w-3.5", isActive && "animate-spin")}
      />
    </div>
  );
});

const PhaseSummary = React.memo(function PhaseSummary({
  view,
}: {
  view: AgentThinkingView;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs sm:text-sm font-medium truncate">
        {view.activity}
      </div>
      <SummaryMeta view={view} />
    </div>
  );
});

const SummaryMeta = React.memo(function SummaryMeta({
  view,
}: {
  view: AgentThinkingView;
}) {
  // Only show the meta line when there's something to say. Saves a
  // line of vertical space and an empty `<div>` on idle frames.
  const hasMeta =
    view.subQueryCount > 0 ||
    view.sourceCount > 0 ||
    view.pagesRead > 0 ||
    view.phase !== "done"; // always show phase label for active phases
  if (!hasMeta) return null;
  return (
    <div className="text-[10px] sm:text-xs text-muted-foreground">
      {view.phaseLabel}
      {view.subQueryCount > 0 && (
        <span> · {view.subQueryCount} queries</span>
      )}
      {view.sourceCount > 0 && (
        <span> · {view.sourceCount} sources</span>
      )}
      {view.pagesRead > 0 && <span> · {view.pagesRead} pages read</span>}
    </div>
  );
});

interface ExpandedBodyProps {
  view: AgentThinkingView;
  showSteps: boolean;
  showSources: boolean;
  onToggleSteps: () => void;
  onToggleSources: () => void;
}

const ExpandedBody = React.memo(function ExpandedBody({
  view,
  showSteps,
  showSources,
  onToggleSteps,
  onToggleSources,
}: ExpandedBodyProps) {
  return (
    <div className="space-y-3 pt-2 border-t">
      <PlanSection plan={view.plan} />
      <SourcesSection
        sources={view.sources}
        expanded={showSources}
        onToggle={onToggleSources}
      />
      <StepsSection
        steps={view.planSteps}
        expanded={showSteps}
        onToggle={onToggleSteps}
      />
      {view.error && <ErrorBanner error={view.error} className="mt-2" />}
    </div>
  );
});

// ── Plan section ────────────────────────────────────────────────────

const PlanSection = React.memo(function PlanSection({
  plan,
}: {
  plan: AgentState["plan"];
}) {
  if (!plan) return null;
  // Snake→camel migration — schema now uses camelCase consistently.
  // Both fields live on `plan` either as declared or via the
  // index-signature pass-through that the wire may surface; we
  // tolerate both.
  const subQueries =
    (plan as { subQueries?: unknown }).subQueries ??
    (plan as { sub_queries?: unknown }).sub_queries;
  const synthHint =
    (plan as { synthesizeHint?: unknown }).synthesizeHint ??
    (plan as { synthesize_hint?: unknown }).synthesize_hint;
  const hasSubQueries = Array.isArray(subQueries) && subQueries.length > 0;
  const hasReason = typeof plan.reason === "string" && plan.reason.length > 0;
  const hasSynthHint = typeof synthHint === "string" && synthHint.length > 0;
  if (!hasSubQueries && !hasReason) return null;

  return (
    <div className="space-y-2">
      {hasReason && (
        <div className="rounded-md bg-muted/40 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Plan
          </p>
          <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
            {plan.reason}
          </p>
          {hasSynthHint && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Answer style: {synthHint as string}
            </p>
          )}
        </div>
      )}
      {hasSubQueries && <SubQueryList queries={subQueries} />}
    </div>
  );
});

const SubQueryList = React.memo(function SubQueryList({
  queries,
}: {
  queries: PlanSubQuery[];
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Search queries
      </p>
      <ul className="space-y-1.5">
        {queries.map((q, i) => (
          <SubQueryRow key={q.id ?? `q${i}`} query={q} index={i} />
        ))}
      </ul>
    </div>
  );
});

const SubQueryRow = React.memo(function SubQueryRow({
  query,
  index,
}: {
  query: PlanSubQuery;
  index: number;
}) {
  const intent = String(query.intent ?? "");
  const qText = String(query.query ?? "");
  const showIntent = intent && qText && intent !== qText;
  const idLabel = String(query.id ?? `q${index + 1}`);

  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2.5 py-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono text-muted-foreground">
          {idLabel}
        </span>
        {query.source && (
          <Badge variant="outline" className="text-[9px] h-4 px-1.5">
            {String(query.source)}
          </Badge>
        )}
        {query.year != null && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
            {String(query.year)}
          </Badge>
        )}
      </div>
      <p className="text-xs sm:text-sm font-medium leading-snug break-words">
        {qText || intent}
      </p>
      {showIntent && (
        <p className="text-[11px] text-muted-foreground break-words">
          {intent}
        </p>
      )}
    </li>
  );
});

// ── Sources section ─────────────────────────────────────────────────

interface SourcesSectionProps {
  sources: AgentState["sources"];
  expanded: boolean;
  onToggle: () => void;
}

const SourcesSection = React.memo(function SourcesSection({
  sources,
  expanded,
  onToggle,
}: SourcesSectionProps) {
  if (sources.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            expanded && "rotate-90",
          )}
        />
        Sources ({sources.length})
      </button>
      {expanded && (
        <div className="grid grid-cols-1 gap-1">
          {sources.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
        </div>
      )}
    </div>
  );
});

const SourceRow = React.memo(function SourceRow({
  source,
}: {
  source: AgentState["sources"][number];
}) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 p-1.5 rounded hover:bg-accent/30 text-[10px] sm:text-xs"
    >
      <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono shrink-0">
        {source.id}
      </Badge>
      <span className="truncate">{source.title}</span>
      <span className="text-muted-foreground truncate hidden sm:inline">
        {source.domain}
      </span>
    </a>
  );
});

// ── Steps section ───────────────────────────────────────────────────

interface StepsSectionProps {
  steps: AgentState["planSteps"];
  expanded: boolean;
  onToggle: () => void;
}

const StepsSection = React.memo(function StepsSection({
  steps,
  expanded,
  onToggle,
}: StepsSectionProps) {
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            expanded && "rotate-90",
          )}
        />
        Steps ({steps.length})
      </button>
      {expanded && (
        <ol className="space-y-0.5 pl-2 border-l-2 border-muted">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </ol>
      )}
    </div>
  );
});

const StepRow = React.memo(function StepRow({
  step,
}: {
  step: AgentState["planSteps"][number];
}) {
  const isRunning = step.status === "running";
  const isDone = step.status === "done";
  const isError = step.status === "error";
  return (
    <li className="flex items-center gap-2 py-0.5 text-[10px] sm:text-xs">
      <div
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          isRunning
            ? "bg-primary animate-pulse"
            : isDone
              ? "bg-green-500"
              : isError
                ? "bg-destructive"
                : "bg-muted-foreground",
        )}
      />
      <span
        className={cn(
          "truncate",
          isRunning ? "font-medium" : "text-muted-foreground",
        )}
      >
        {step.intent}
        {step.detail ? `: ${step.detail}` : ""}
      </span>
      {isDone && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
    </li>
  );
});

// ── Inline variant (compact) ────────────────────────────────────────

export const AgentThinkingInline = React.memo(function AgentThinkingInline({
  events,
}: {
  events: AnvilEvent[];
}) {
  const state = useAgentState({ sharedEvents: events });
  if (state.phase === "idle") return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{getActivity(state)}</span>
    </div>
  );
});

export { useAgentState } from "@anvil/react-headless";