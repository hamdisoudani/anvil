import type { AnvilEvent } from "@anvil/client";
export type AgentPhase = "idle" | "planning" | "searching" | "fetching" | "synthesizing" | "done" | "error";
export interface AgentStepEvent {
    id: number;
    intent: string;
    status: "running" | "done" | "error";
    detail?: string;
    timestamp: number;
}
export interface AgentPlan {
    needs_search: boolean;
    reason: string;
    sub_queries: Array<{
        id: string;
        intent: string;
        query: string;
        source: string;
        year?: number;
        fetch_top?: number;
    }>;
    synthesize_hint?: string;
}
export interface AgentSource {
    id: number;
    url: string;
    title: string;
    domain: string;
    used?: boolean;
}
export interface AgentProgress {
    searchesDone: number;
    searchesTotal: number;
    pagesRead: number;
    pagesTotal: number;
}
export interface AgentState {
    /** Machine-readable phase */
    phase: AgentPhase;
    /** Human-readable current activity */
    activity: string;
    /** Full timeline of plan step events */
    steps: AgentStepEvent[];
    /** Current active step (or null) */
    currentStep: AgentStepEvent | null;
    /** The parsed plan (from show_plan_step frontend.call) */
    plan: AgentPlan | null;
    /** Sources discovered so far */
    sources: AgentSource[];
    /** Progress counters */
    progress: AgentProgress;
    /** Accumulated answer text so far */
    answer: string;
    /** Error message if any */
    error: string | null;
}
export declare function useAgentState(events: AnvilEvent[]): AgentState;
//# sourceMappingURL=useAgentState.d.ts.map