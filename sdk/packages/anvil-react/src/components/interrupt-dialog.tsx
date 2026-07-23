"use client";

/**
 * InterruptDialog — Human-in-the-loop dialog for frontend tool calls.
 *
 * When the agent calls a frontend tool (e.g. "approve_deploy", "render_form",
 * "get_user_choice"), the browser-side `useAgent` hook surfaces it via
 * `agent.pendingInterrupt`. This dialog handles that — renders an
 * approval UI, calls `approveInterrupt(result)` or `rejectInterrupt(reason)`.
 *
 * DEFAULT BEHAVIOR: Show a modal with the interrupt's input as
 * editable JSON + Approve / Reject buttons. Simple, predictable, and
 * works without any schema.
 *
 * ESCAPE HATCH: Pass `renderer` to take full control of the dialog UI:
 *
 * ```tsx
 * <InterruptDialog
 *   renderer={({ interrupt, approve, reject }) => (
 *     <MyCustomDialog
 *       input={interrupt.input}
 *       onApprove={(result) => approve(result)}
 *       onReject={(reason) => reject(reason)}
 *     />
 *   )}
 * />
 * ```
 */

import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { Check, X } from "lucide-react";
import { cn } from "../lib/utils";

// ── Types ────────────────────────────────────────────────────────────

/**
 * The shape of an interrupt from the agent. Mirrors `PendingInterrupt`
 * from `@anvil/react-headless` but is duplicated here to avoid an
 * import cycle (anvil-react is a peer, not a child).
 */
export interface InterruptLike {
  callId: string;
  toolName: string;
  input: unknown;
  isFrontend?: boolean;
}

export interface InterruptDialogRendererProps {
  interrupt: InterruptLike;
  approve: (result: unknown) => void;
  reject: (reason?: string) => void;
}

export interface InterruptDialogProps {
  /** Override the dialog UI entirely. */
  renderer?: (props: InterruptDialogRendererProps) => ReactNode;
  /** Called after the user resolves the interrupt (any outcome). */
  onResolved?: (outcome: "approved" | "rejected") => void;
  /** Optional CSS class for the dialog container. */
  className?: string;
  /** The interrupt to render (when using controlled mode). */
  interrupt?: InterruptLike | null;
  /** Approve handler (controlled mode). */
  onApprove?: (result: unknown) => void;
  /** Reject handler (controlled mode). */
  onReject?: (reason?: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

function defaultTitleFor(interrupt: InterruptLike): string {
  // Strip snake_case / camelCase tool names into Title Case
  // e.g. "approve_deploy" -> "Approve Deploy"
  const raw = interrupt.toolName.replace(/_/g, " ");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ── Default dialog body ──────────────────────────────────────────────

function DefaultBody({
  interrupt,
  approve,
  reject,
}: InterruptDialogRendererProps) {
  const [jsonText, setJsonText] = useState<string>(
    JSON.stringify(interrupt.input ?? {}, null, 2),
  );
  const [parsedValue, setParsedValue] = useState<unknown>(interrupt.input);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleApprove = () => {
    if (jsonError) return;
    approve(parsedValue);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          The agent wants to run{" "}
          <span className="font-mono font-medium text-foreground">
            {interrupt.toolName}
          </span>
          . Review the input below and approve or reject.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Result (JSON)
        </label>
        <Textarea
          rows={8}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            try {
              setParsedValue(JSON.parse(e.target.value));
              setJsonError(null);
            } catch (err) {
              setJsonError(
                err instanceof Error ? err.message : "Invalid JSON",
              );
            }
          }}
          className="font-mono text-xs"
        />
        {jsonError && (
          <p className="text-xs text-destructive">{jsonError}</p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => reject("User rejected the interrupt")}
        >
          <X className="mr-1.5 h-4 w-4" /> Reject
        </Button>
        <Button onClick={handleApprove} disabled={!!jsonError}>
          <Check className="mr-1.5 h-4 w-4" /> Approve
        </Button>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────

/**
 * Render an interrupt dialog when the agent has a pending frontend
 * tool call. Returns null when there's no pending interrupt.
 *
 * Two modes:
 *   - Direct: `<InterruptDialog interrupt={i} onApprove={fn} onReject={fn} />`
 *   - Inside <AgentProvider>: just `<InterruptDialog interrupt={...}/>`
 *     (the parent decides when to show it)
 *
 * For agent-driven mode, render this inside your ChatUI:
 *
 * ```tsx
 * {agent.pendingInterrupt && (
 *   <InterruptDialog
 *     interrupt={agent.pendingInterrupt}
 *     onApprove={(r) => agent.approveInterrupt(r)}
 *     onReject={(reason) => agent.rejectInterrupt(reason)}
 *   />
 * )}
 * ```
 */
export function InterruptDialog(
  props: InterruptDialogProps,
) {
  const {
    interrupt,
    onApprove,
    onReject,
    renderer,
    onResolved,
    className,
  } = props;

  if (!interrupt || !onApprove || !onReject) {
    return null;
  }

  const renderProps: InterruptDialogRendererProps = {
    interrupt,
    approve: (r) => {
      onApprove(r);
      onResolved?.("approved");
    },
    reject: (reason) => {
      onReject(reason);
      onResolved?.("rejected");
    },
  };

  const body = renderer ? renderer(renderProps) : <DefaultBody {...renderProps} />;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={defaultTitleFor(interrupt)}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4",
        className,
      )}
      onClick={(e) => {
        // Backdrop click rejects — common UX
        if (e.target === e.currentTarget) {
          onReject("Dialog dismissed");
        }
      }}
    >
      <div className="relative w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-4">
          <h2 className="text-base font-semibold">
            {defaultTitleFor(interrupt)}
          </h2>
        </div>
        {body}
      </div>
    </div>
  );
}