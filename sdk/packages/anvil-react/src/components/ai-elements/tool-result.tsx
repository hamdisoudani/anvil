"use client";

/**
 * <ToolResult> — render a tool call result in the chat UI.
 *
 * The `useChat` reducer attaches `toolResult` / `toolError` to tool
 * messages. This component renders them with sensible defaults:
 *   - string → plain text
 *   - JSON object → monospace JSON block
 *   - anything else → JSON.stringify fallback
 *
 * ESCAPE HATCH: pass `renderer` for full control:
 *
 * ```tsx
 * <ToolResult
 *   toolName="get_weather"
 *   result={data}
 *   renderer={({ result, toolName }) => (
 *     <WeatherCard city={result.city} temp={result.temp} />
 *   )}
 * />
 * ```
 *
 * For tool results that need loading / approval / confirmation UI,
 * pass `children` for fully custom rendering.
 */

import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, Wrench } from "lucide-react";
import { cn } from "../../lib/utils";

// ── Types ────────────────────────────────────────────────────────────

export interface ToolResultProps {
  /** Name of the tool that produced this result. */
  toolName: string;
  /** The tool's return value (may be any JSON-serializable shape). */
  result?: unknown;
  /** Error string if the tool failed. Mutually exclusive with success display. */
  error?: string;
  /** Custom renderer — takes priority over the default JSON formatter. */
  renderer?: (props: {
    toolName: string;
    result: unknown;
    error?: string;
  }) => ReactNode;
  /** Loading state — shows a spinner instead of content. */
  loading?: boolean;
  /** Optional className. */
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDefault(result: unknown): ReactNode {
  if (result == null) {
    return <span className="text-xs text-muted-foreground">(empty)</span>;
  }
  if (typeof result === "string") {
    return (
      <p className="text-sm whitespace-pre-wrap break-words">{result}</p>
    );
  }
  if (typeof result === "number" || typeof result === "boolean") {
    return <span className="text-sm font-mono">{String(result)}</span>;
  }
  // Object / array — pretty-printed JSON in a monospace block
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap break-all">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

// ── Component ────────────────────────────────────────────────────────

export function ToolResult({
  toolName,
  result,
  error,
  renderer,
  loading,
  className,
}: ToolResultProps) {
  const isError = !!error;
  const Icon = isError ? AlertCircle : CheckCircle2;

  if (renderer) {
    return (
      <div className={cn("rounded-md border bg-card/50 p-3", className)}>
        {renderer({ toolName, result, error })}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-card/50 p-3 text-sm text-muted-foreground",
          className,
        )}
      >
        <Wrench className="h-4 w-4 animate-pulse" />
        <span>
          Running <span className="font-mono">{toolName}</span>…
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-card/50 p-3 space-y-2",
        isError && "border-destructive/40 bg-destructive/5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            isError ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
          )}
        />
        <span className="font-medium">
          {isError ? "Failed" : "Result"}{" "}
          <span className="font-mono text-muted-foreground">{toolName}</span>
        </span>
      </div>
      {isError ? (
        <p className="text-sm text-destructive break-words">{error}</p>
      ) : (
        formatDefault(result)
      )}
    </div>
  );
}