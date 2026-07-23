/**
 * Canonical agent-state shape — the headless layer's runtime view of
 * the event stream.
 *
 * This file defines `AgentState` in the same package as the schema, so
 * the canonical event types and the derived view-model live side-by-side.
 * It's imported by anvil-react-headless to build useAgentState / useChat.
 */

import type {
  AgentSource,
  PlanObject,
  PlanStep,
  ErrorPayload,
} from "../schema";

export type { AgentSource, PlanStep } from "../schema";

/** @deprecated Use SubQuery from "../schema". */
export type PlanSubQuery = NonNullable<PlanObject["subQueries"]>[number];

export type AgentPhase =
  | "idle"
  | "planning"
  | "searching"
  | "reading"
  | "writing"
  | "done"
  | "error";

export interface AgentPlan {
  /** Why the agent chose this plan. */
  reason?: string;
  /** Style guidance for the final synthesis. */
  synthesizeHint?: string;
  /** Whether the agent decided to search. */
  needsSearch?: boolean;
  /** Decomposed sub-queries. */
  subQueries?: NonNullable<PlanObject["subQueries"]>;
  /** Raw pass-through for unknown fields. */
  [key: string]: unknown;
}

export interface AgentState {
  /** Current high-level phase. */
  phase: AgentPhase;
  /** Original task. */
  task: string | null;
  /** Owning session. */
  sessionId: string | null;
  /** Owning thread. */
  threadId: string | null;
  /** Full plan-step timeline (one entry per step transition). */
  planSteps: PlanStep[];
  /** Current plan object (replaced on each plan.set). */
  plan: AgentPlan | null;
  /** All sources discovered (deduplicated by URL). */
  sources: AgentSource[];
  /** Search steps that completed. */
  searchesDone: number;
  /** Read steps that completed. */
  pagesRead: number;
  /** Most recently received step's index. -1 if none. */
  currentStepIndex: number;
  /** Accumulated reasoning text from think.chunk events. */
  currentReasoning: string;
  /** Accumulated answer text from answer.chunk events. */
  currentAnswer: string;
  /** Whether the agent is actively streaming the answer. */
  isStreaming: boolean;
  /** Structured error info. */
  error: ErrorPayload | null;
  /** Whether the terminal 'done' event has been received. */
  doneReceived: boolean;
}

export const INITIAL_AGENT_STATE: AgentState = {
  phase: "idle",
  task: null,
  sessionId: null,
  threadId: null,
  planSteps: [],
  plan: null,
  sources: [],
  searchesDone: 0,
  pagesRead: 0,
  currentStepIndex: -1,
  currentReasoning: "",
  currentAnswer: "",
  isStreaming: false,
  error: null,
  doneReceived: false,
};
