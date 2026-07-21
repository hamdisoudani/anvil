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
import {
  AgentState,
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

// ── Phase icons ──────────────────────────────────────────────────

const PHASE_ICONS: Record<string, any> = {
  idle: Loader2,
  planning: Search,
  searching: Globe,
  reading: BookOpen,
  writing: Pencil,
  done: CheckCircle2,
  error: XCircle,
};

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  planning: "Planning",
  searching: "Searching",
  reading: "Reading",
  writing: "Writing",
  done: "Done",
  error: "Error",
};

function getActivity(state: AgentState): string {
  const lastStep = state.planSteps[state.currentStepIndex];
  if (lastStep?.status === "running") {
    return lastStep.intent + (lastStep.detail ? `: ${lastStep.detail}` : "");
  }
  if (state.isStreaming) return "Writing answer…";
  if (state.phase === "done") return "Done";
  if (state.phase === "error") return state.error?.message ?? "Error";
  return PHASE_LABELS[state.phase] ?? state.phase;
}

// ── Main component ───────────────────────────────────────────────

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

export function AgentThinking({
  events,
  defaultExpanded = false,
  className,
  compact = false,
}: AgentThinkingProps) {
  const state = useAgentState({ sharedEvents: events });
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showSteps, setShowSteps] = useState(false);
  const [showSources, setShowSources] = useState(false);

  if (state.phase === "idle") return null;

  const Icon = PHASE_ICONS[state.phase];
  const isActive = state.phase !== "done" && state.phase !== "error";
  const activity = getActivity(state);

  const containerClass = compact
    ? cn("flex flex-col gap-1", className)
    : cn("rounded-lg border bg-card p-3 sm:p-4 space-y-3", className);

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 text-left"
      >
        <div
          className={cn(
            "flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full shrink-0",
            isActive
              ? "bg-primary/10 text-primary"
              : state.phase === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icon
            className={cn("h-3 sm:h-3.5 w-3 sm:w-3.5", isActive && "animate-spin")}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs sm:text-sm font-medium truncate">
            {activity}
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            {PHASE_LABELS[state.phase]}
            {state.plan && Array.isArray((state.plan as any).sub_queries) && (state.plan as any).sub_queries.length > 0 && (
              <span> · {(state.plan as any).sub_queries.length} queries</span>
            )}
            {state.sources.length > 0 && (
              <span> · {state.sources.length} sources</span>
            )}
            {state.pagesRead > 0 && (
              <span> · {state.pagesRead} pages read</span>
            )}
          </div>
        </div>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 pt-2 border-t">
          {state.plan && Array.isArray((state.plan as any).sub_queries) && (state.plan as any).sub_queries.length > 0 && (
            <div className="space-y-1.5">
              {((state.plan as any).reason as string) && (
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {String((state.plan as any).reason)}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {((state.plan as any).sub_queries as any[]).map((q: any, i: number) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="text-[9px] sm:text-[10px]"
                  >
                    {String(q.query || q.intent || "")}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {state.sources.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowSources(!showSources)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showSources && "rotate-90",
                  )}
                />
                Sources ({state.sources.length})
              </button>
              {showSources && (
                <div className="grid grid-cols-1 gap-1">
                  {state.sources.map((s) => (
                    <a
                      key={s.id}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-accent/30 text-[10px] sm:text-xs"
                    >
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[9px] font-mono shrink-0"
                      >
                        {s.id}
                      </Badge>
                      <span className="truncate">{s.title}</span>
                      <span className="text-muted-foreground truncate hidden sm:inline">
                        {s.domain}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {state.planSteps.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowSteps(!showSteps)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showSteps && "rotate-90",
                  )}
                />
                Steps ({state.planSteps.length})
              </button>
              {showSteps && (
                <div className="space-y-0.5 pl-2 border-l-2 border-muted">
                  {state.planSteps.map((step, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 py-0.5 text-[10px] sm:text-xs"
                    >
                      <div
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          step.status === "running"
                            ? "bg-primary animate-pulse"
                            : step.status === "done"
                              ? "bg-green-500"
                              : step.status === "error"
                                ? "bg-destructive"
                                : "bg-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "truncate",
                          step.status === "running"
                            ? "font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {step.intent}
                        {step.detail ? `: ${step.detail}` : ""}
                      </span>
                      {step.status === "done" && (
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error banner when phase is error */}
          {state.error && (
            <ErrorBanner
              error={state.error}
              className="mt-2"
            />
          )}
        </div>
      )}
    </div>
  );
}

export function AgentThinkingInline({ events }: { events: AnvilEvent[] }) {
  const state = useAgentState({ sharedEvents: events });
  if (state.phase === "idle") return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{getActivity(state)}</span>
    </div>
  );
}

export { useAgentState } from "@anvil/react-headless";
