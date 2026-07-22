"use client";

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
import {
  AlertCircle,
  AlertTriangle,
  Info,
  XCircle,
  ChevronDown,
  ChevronRight,
  RotateCw,
  X,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

export interface AgentErrorLike {
  message: string;
  code?: string;
  severity?: "info" | "warning" | "error" | "fatal";
  recoverable?: boolean;
  retryable?: boolean;
  stepId?: string;
  raw?: unknown;
}

export interface ErrorBannerProps {
  /** The error — either a structured AgentError object or a plain string. */
  error: AgentErrorLike | string;
  /** Called when the user wants to retry (only shown when retryable). */
  onRetry?: () => void;
  /** Called when the user dismisses the banner. */
  onDismiss?: () => void;
  /** Optional CSS class override. */
  className?: string;
}

// ── Severity config ──────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  NonNullable<AgentErrorLike["severity"]>,
  {
    icon: typeof AlertCircle;
    containerClass: string;
    borderClass: string;
    textClass: string;
    badgeVariant: "default" | "secondary" | "destructive" | "outline";
    label: string;
  }
> = {
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

function normalizeError(
  err: AgentErrorLike | string,
): AgentErrorLike {
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

export function ErrorBanner({
  error,
  onRetry,
  onDismiss,
  className,
}: ErrorBannerProps) {
  const [showDetails, setShowDetails] = useState(false);
  const err = normalizeError(error);
  const severity = err.severity ?? "error";
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;

  const hasRaw = err.raw !== undefined && err.raw !== null;
  const isRetryable = err.retryable === true && typeof onRetry === "function";

  return (
    <div
      role="alert"
      className={cn(
        "relative rounded-lg border p-3 text-sm",
        cfg.containerClass,
        cfg.borderClass,
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", cfg.textClass)} />

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Top row: severity label + code badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-xs font-medium", cfg.textClass)}>
              {cfg.label}
            </span>
            {err.code && (
              <Badge variant={cfg.badgeVariant} className="text-[10px] px-1.5 py-0 font-mono">
                {err.code}
              </Badge>
            )}
            {err.stepId && (
              <span className="text-[10px] text-muted-foreground font-mono">
                step: {err.stepId}
              </span>
            )}
          </div>

          {/* Message */}
          <p className="text-xs sm:text-sm text-foreground break-words">
            {err.message}
          </p>

          {/* Collapsible raw details */}
          {hasRaw && (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDetails ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showDetails ? "Hide details" : "Show details"}
              </button>
              {showDetails && (
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[10px] text-muted-foreground font-mono whitespace-pre-wrap break-all">
                  {typeof err.raw === "string"
                    ? err.raw
                    : JSON.stringify(err.raw, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isRetryable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRetry}
              title="Retry"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
          )}
          {typeof onDismiss === "function" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onDismiss}
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
