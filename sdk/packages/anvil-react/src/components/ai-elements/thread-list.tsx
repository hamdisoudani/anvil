"use client";

/**
 * <ThreadList> — render the user's saved threads.
 *
 * Pulls from the AnvilShell context by default (just call
 * `<ThreadList />`). Pass overrides for fully custom UIs.
 *
 * DEFAULT: a collapsible sidebar list with title + date + delete button.
 * ESCAPE HATCH: pass `renderer` for fully custom rendering:
 *
 * ```tsx
 * <ThreadList
 *   renderer={({ threads, onSelect, onDelete }) => (
 *     <MySidebar
 *       threads={threads}
 *       onSelect={onSelect}
 *       onDelete={onDelete}
 *     />
 *   )}
 * />
 * ```
 *
 * To use without <AnvilShell>, pass `threads`, `onSelect`, `onDelete` directly.
 */

import { useState, type ReactNode } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import {
  useAnvilShell,
  useAnvilShellOptional,
  type ThreadMeta,
} from "@anvil/react-headless";

// ── Types ────────────────────────────────────────────────────────────

export interface ThreadListRendererProps {
  threads: ThreadMeta[];
  /** Currently active thread id (highlighted). */
  activeId: string | null;
  /** Switch to a thread (loads from storage + navigates URL). */
  onSelect: (id: string) => void;
  /** Delete a thread. */
  onDelete: (id: string) => void;
}

export interface ThreadListProps {
  /** Override the entire UI. */
  renderer?: (props: ThreadListRendererProps) => ReactNode;
  /** Override the title shown above the list. */
  title?: ReactNode;
  /** Hide the close button (when used as an inline list, not a popover). */
  hideClose?: boolean;
  /** Called when the close button is clicked. */
  onClose?: () => void;
  /** Optional CSS class. */
  className?: string;
}

// ── Default renderer ────────────────────────────────────────────────

function DefaultThreadList({
  threads,
  activeId,
  onSelect,
  onDelete,
  title,
  hideClose,
  onClose,
  className,
}: ThreadListRendererProps & Pick<ThreadListProps, "title" | "hideClose" | "onClose" | "className">) {
  return (
    <div className={className}>
      <div className="mx-auto max-w-2xl lg:max-w-3xl px-2 sm:px-4 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {title ?? "Recent threads"}
          </span>
          {!hideClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {threads.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No previous threads
          </p>
        ) : (
          threads.map((t) => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-2 group rounded",
                t.id === activeId && "bg-accent/30",
              )}
            >
              <button
                type="button"
                className="flex-1 text-left text-xs py-1.5 px-2 hover:bg-accent/30 truncate"
                onClick={() => onSelect(t.id)}
              >
                <span className="line-clamp-1">{t.title}</span>
                <span className="text-[9px] text-muted-foreground">
                  {new Date(t.timestamp).toLocaleDateString()}
                </span>
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(t.id)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── cn helper (re-implemented locally to avoid import cycle) ────────

function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(" ");
}

// ── Component ────────────────────────────────────────────────────────

export function ThreadList(props: ThreadListProps) {
  const shell = useAnvilShellOptional();

  const { renderer, title, hideClose, onClose, className } = props;

  // If shell is present, use it; otherwise require explicit props.
  // For now, default to shell. Direct-mode (no shell) is not yet
  // supported — the consumer should wrap in <AnvilShell>.
  const threads = shell?.threads ?? [];
  const activeId = shell?.threadId ?? null;
  const onSelect = (id: string) => {
    void shell?.switchToThread(id);
  };
  const onDelete = (id: string) => {
    void shell?.deleteThread(id);
  };

  const renderProps: ThreadListRendererProps = {
    threads,
    activeId,
    onSelect,
    onDelete,
  };

  if (renderer) {
    return <>{renderer(renderProps)}</>;
  }

  return (
    <DefaultThreadList
      {...renderProps}
      title={title}
      hideClose={hideClose}
      onClose={onClose}
      className={className}
    />
  );
}

/**
 * Toggle visibility for a collapsible thread list. Useful as a
 * popover trigger (header button) without managing local state
 * manually.
 */
export function useThreadListToggle(initial = false) {
  return useState(initial);
}