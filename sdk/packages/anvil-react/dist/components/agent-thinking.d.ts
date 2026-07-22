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
import type { AnvilEvent } from "@anvil/client";
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
export declare const AgentThinking: React.NamedExoticComponent<AgentThinkingProps>;
export declare const AgentThinkingInline: React.NamedExoticComponent<{
    events: AnvilEvent[];
}>;
export { useAgentState } from "@anvil/react-headless";
//# sourceMappingURL=agent-thinking.d.ts.map