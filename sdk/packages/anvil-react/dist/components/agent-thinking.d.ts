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
export declare function AgentThinking({ events, defaultExpanded, className, compact, }: AgentThinkingProps): import("react").JSX.Element | null;
export declare function AgentThinkingInline({ events }: {
    events: AnvilEvent[];
}): import("react").JSX.Element | null;
export { useAgentState } from "@anvil/react-headless";
//# sourceMappingURL=agent-thinking.d.ts.map