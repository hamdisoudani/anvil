"use client";

/**
 * Reasoning — collapsible agent thinking display.
 *
 * Behavior matches AI Elements: opens by default when streaming,
 * auto-collapses when isStreaming becomes false.
 *
 * Performance notes:
 *  - Auto-open / auto-collapse is derived from props (no mirror state
 *    and no effect) — eliminates an extra commit on every streaming flip.
 *  - Context value is memoized so consumers don't re-render unless
 *    `open` actually changes (clicking the trigger vs parent rerender).
 */
import * as React from "react";
import { cn } from "../../lib/utils";
import { ChevronRight, Brain } from "lucide-react";

type ReasoningCtx = {
  open: boolean;
  setOpen: (o: boolean) => void;
  isStreaming: boolean;
};

interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  isStreaming?: boolean;
  defaultOpen?: boolean;
}

export function Reasoning({
  isStreaming = false,
  defaultOpen = true,
  className,
  children,
  ...props
}: ReasoningProps) {
  // Auto-open while streaming. Click override sticks (sticky user intent).
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const open = userOpen ?? (isStreaming || defaultOpen);
  const setOpen = React.useCallback((o: boolean) => setUserOpen(o), []);

  // Memoized context — only changes when `open` flips. Consumers reading
  // `isStreaming` won't re-render just because the parent rerendered.
  const ctx = React.useMemo<ReasoningCtx>(
    () => ({ open, setOpen, isStreaming }),
    [open, setOpen, isStreaming],
  );

  return (
    <ReasoningContext.Provider value={ctx}>
      <div
        className={cn(
          "my-2 border border-muted/60 rounded-lg overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ReasoningContext.Provider>
  );
}

const ReasoningContext = React.createContext<ReasoningCtx | null>(null);

function useReasoning() {
  const ctx = React.useContext(ReasoningContext);
  if (!ctx) throw new Error("useReasoning must be inside <Reasoning>");
  return ctx;
}

interface ReasoningTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  title?: string;
}

export function ReasoningTrigger({
  title = "Reasoning",
  className,
  ...props
}: ReasoningTriggerProps) {
  const { open, setOpen, isStreaming } = useReasoning();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors",
        className,
      )}
      {...props}
    >
      <Brain
        className={cn(
          "h-3 w-3 shrink-0",
          isStreaming && "animate-pulse text-primary",
        )}
      />
      <span className="flex-1 text-left truncate">
        {title}
        {isStreaming && (
          <span className="ml-1.5 text-primary">· thinking…</span>
        )}
      </span>
      <ChevronRight
        className={cn(
          "h-3 w-3 shrink-0 transition-transform",
          open && "rotate-90",
        )}
      />
    </button>
  );
}

interface ReasoningContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const ReasoningContent = React.memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  const { open } = useReasoning();
  if (!open) return null;
  return (
    <div
      className={cn(
        "px-2.5 sm:px-3 py-2 text-[11px] sm:text-xs text-muted-foreground border-t border-muted/60 bg-muted/10 max-h-60 overflow-y-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});