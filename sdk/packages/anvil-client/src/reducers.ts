/**
 * Pure reducers — framework-agnostic.
 *
 * These functions consume the canonical `AnvilEvent` schema (from
 * `./schema`) and produce view-model state (`AgentState`,
 * `ChatMessage[]`). They are pure — no React, no side effects — so
 * they can be used by React, Vue, Svelte, vanilla JS, server-side
 * rendering, or unit tests.
 *
 * The React hooks (`useAgentState`, `useChat`) call these reducers
 * inside a `useMemo`, so the result is memoized across renders.
 *
 * IMPORTANT: Both live-stream reducers (`reduceAgentStateFromEvents`)
 * and thread-history reducers (`agentStateFromTurnRecord`,
 * `messagesFromTurnRecords`) feed the SAME view-model shapes. That
 * means a component built for live streaming renders identically when
 * fed a hydrated history. No special-casing in the UI layer.
 */

import {
  type AnvilEvent,
  type AnyAnvilEvent,
  type ChatMessage,
  type PlanStep,
  type AgentSource,
  type TurnRecord,
} from "./schema";
import {
  type AgentPhase,
  type AgentPlan,
  type AgentState,
  INITIAL_AGENT_STATE,
} from "./types/agent-state";
import {
  isAnswerChunk,
  isAnswerEnd,
  isDone,
  isErrorEvent,
  isFrontendCall,
  isPlanSet,
  isPlanStep,
  isSessionStart,
  isSourcesFound,
  isSubagentStart,
  isThinkChunk,
  isThinkEnd,
  isToolCall,
  isToolResult,
} from "./schema";

// ── Phase inference ─────────────────────────────────────────────────

/**
 * Derive the current `AgentPhase` from accumulated state. Kept as a
 * pure function so it can be unit-tested without React.
 */
function derivePhase(state: AgentState): AgentPhase {
  if (state.doneReceived) return "done";
  if (state.error) return "error";
  if (state.isStreaming) return "writing";

  const lastStep =
    state.currentStepIndex >= 0 ? state.planSteps[state.currentStepIndex] : null;
  if (lastStep) {
    const intent = lastStep.intent.toLowerCase();
    const tool = lastStep.tool?.toLowerCase();
    if (tool === "search" || /search/.test(intent)) return "searching";
    if (tool === "fetch_page" || /read|fetch|extract/.test(intent))
      return "reading";
    return "searching";
  }
  if (state.plan) return "planning";
  return state.phase === "idle" ? "idle" : "planning";
}

// ── Custom reducer registry (extension point) ──────────────────────

/**
 * A custom reducer is a pure function that takes the current
 * AgentState and a custom event (any shape with at least a `type`
 * string and a `payload`) and returns the next state. Use this when
 * your agent emits custom event types not in the canonical schema.
 *
 * ```ts
 * import { registerReducer } from "@anvil/client";
 *
 * registerReducer("cost.update", (state, event) => ({
 *   ...state,
 *   extensions: {
 *     ...state.extensions,
 *     costSoFar: (event.payload as { usd: number }).usd,
 *   },
 * }));
 * ```
 */
export type CustomEventHandler = (
  state: AgentState,
  event: { type: string; payload: unknown },
) => AgentState;

const customReducers = new Map<string, CustomEventHandler>();

/**
 * Register a custom reducer for a specific event type. Custom
 * reducers run AFTER the canonical reducer for known events. For
 * unknown event types, they're the only reducer.
 *
 * Idempotent: calling registerReducer twice with the same type
 * replaces the previous handler (no leak).
 */
export function registerReducer(
  type: string,
  handler: CustomEventHandler,
): () => void {
  customReducers.set(type, handler);
  return () => {
    if (customReducers.get(type) === handler) {
      customReducers.delete(type);
    }
  };
}

/**
 * Test/dev only: clear all custom reducers. Not for production use —
 * custom reducers are global.
 */
export function __clearCustomReducers(): void {
  customReducers.clear();
}

/**
 * Read-only snapshot of the current custom reducer registry.
 * Useful for debugging and testing.
 */
export function listCustomReducers(): string[] {
  return Array.from(customReducers.keys());
}

// ── Live reducer (event log → AgentState) ───────────────────────────

/**
 * Reduce a single event into the next AgentState. Pure function.
 *
 * Behavior:
 *   - Known event types: dispatched via the canonical cases below.
 *   - Unknown event types (no `type` in EVENT_TYPES, or marked
 *     `_unknown` from `fromWire`): if a custom reducer is registered
 *     for that type, it's called. Otherwise, the event is dropped
 *     (state unchanged).
 *
 * The return type is intentionally `AgentState` (not narrowed). Custom
 * reducers can return any subset that satisfies AgentState.
 */
export function reduceAgentState(
  state: AgentState,
  event: AnyAnvilEvent | { type: string; payload: unknown },
): AgentState {
  // Custom reducer hook — runs BEFORE canonical handling so devs can
  // intercept events with their own logic. (If your custom reducer
  // returns the same shape as the canonical one, the canonical one
  // will still run — register custom logic for unknown types to avoid
  // double-handling.)
  const custom = customReducers.get(event.type);
  if (custom) {
    state = custom(state, event);
  }
  // From here on, narrow to AnyAnvilEvent for the canonical cases
  // below. For custom event shapes (no eventId/sessionId/etc), the
  // type guards reject them and we return state unchanged.
  if (!("eventId" in event)) {
    return state;
  }
  const e = event as AnyAnvilEvent;
  // session.start resets transient state but PRESERVES planSteps,
  // sources, and reasoning (so multi-turn history stays intact).
  if (isSessionStart(e)) {
    return {
      ...INITIAL_AGENT_STATE,
      phase: "planning",
      task: e.payload.task,
      threadId: e.payload.threadId,
      sessionId: e.sessionId,
    };
  }

  if (isThinkChunk(e)) {
    return {
      ...state,
      currentReasoning: state.currentReasoning + e.payload.delta,
    };
  }

  if (isThinkEnd(e)) {
    return {
      ...state,
      currentReasoning: e.payload.text || state.currentReasoning,
    };
  }

  if (isPlanStep(e)) {
    const step = e.payload.step;
    // Replace any existing step with the same id (status updates),
    // otherwise append.
    const idx = state.planSteps.findIndex((s) => s.id === step.id);
    const steps =
      idx >= 0
        ? state.planSteps.map((s, i) => (i === idx ? step : s))
        : [...state.planSteps, step];
    const searchesDone =
      step.status === "done" &&
      (step.tool === "search" || /search/.test(step.intent.toLowerCase()))
        ? state.searchesDone + 1
        : state.searchesDone;
    const pagesRead =
      step.status === "done" &&
      (step.tool === "fetch_page" || /read|fetch|extract/.test(step.intent.toLowerCase()))
        ? state.pagesRead + 1
        : state.pagesRead;
    return {
      ...state,
      planSteps: steps,
      currentStepIndex: state.planSteps.length === 0 ? 0 : state.planSteps.length,
      searchesDone,
      pagesRead,
    };
  }

  if (isPlanSet(e)) {
    const plan: AgentPlan = {
      reason: e.payload.plan.reason,
      synthesizeHint: e.payload.plan.synthesizeHint,
      needsSearch: e.payload.plan.needsSearch,
      subQueries: e.payload.plan.subQueries ?? [],
    };
    return { ...state, plan };
  }

  if (isSourcesFound(e)) {
    return { ...state, sources: e.payload.sources };
  }

  if (isAnswerChunk(e)) {
    return {
      ...state,
      isStreaming: true,
      currentAnswer: state.currentAnswer + e.payload.delta,
    };
  }

  if (isAnswerEnd(e)) {
    return {
      ...state,
      isStreaming: false,
      currentAnswer: e.payload.text || state.currentAnswer,
    };
  }

  if (isErrorEvent(e)) {
    return { ...state, error: e.payload };
  }

  if (isDone(e)) {
    return {
      ...state,
      doneReceived: true,
      isStreaming: false,
      // Done may carry the final answer; merge if we missed any chunks.
      currentAnswer: state.currentAnswer || e.payload.answer || "",
      sources: e.payload.sources ?? state.sources,
      // Final plan may also be delivered with done.
      plan: e.payload.plan
        ? {
            reason: e.payload.plan.reason,
            synthesizeHint: e.payload.plan.synthesizeHint,
            needsSearch: e.payload.plan.needsSearch,
            subQueries: e.payload.plan.subQueries ?? [],
          }
        : state.plan,
    };
  }

  return state;
}

/**
 * Reduce an entire event log to the final AgentState. Used by
 * `useAgentState` (with `useMemo` for memoization).
 */
export function reduceAgentStateFromEvents(
  events: AnvilEvent[],
): AgentState {
  let state: AgentState = INITIAL_AGENT_STATE;
  for (const e of events) {
    state = reduceAgentState(state, e);
  }
  state.phase = derivePhase(state);
  return state;
}

// ── Chat reducer (event log → ChatMessage[]) ────────────────────────

/**
 * Reduce an entire event log into chat-style messages. Each user
 * turn becomes one user message + one assistant message. Each
 * assistant message accumulates streamed answer chunks and has its
 * metadata (sources, related) attached on `done`.
 *
 * Sub-agent events become their own assistant messages with the
 * `subAgentId` / `subAgentRole` metadata attached.
 */
export function reduceEventsToMessages(events: AnvilEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let currentAssistant: ChatMessage | null = null;
  let pendingSources: AgentSource[] | null = null;

  for (const e of events) {
    if (isSessionStart(e)) {
      pendingSources = null;
      if (e.payload.task) {
        out.push({
          id: `user-${e.eventId}`,
          role: "user",
          content: e.payload.task,
          timestamp: Date.parse(e.createdAt),
        });
      }
      continue;
    }

    if (isAnswerChunk(e)) {
      if (!currentAssistant) {
        currentAssistant = {
          id: `assistant-${e.eventId}`,
          role: "assistant",
          content: "",
          timestamp: Date.parse(e.createdAt),
          isStreaming: true,
          sources: pendingSources ?? undefined,
        };
        out.push(currentAssistant);
        pendingSources = null;
      }
      currentAssistant.content += e.payload.delta;
      const idx = out.indexOf(currentAssistant);
      if (idx >= 0) {
        currentAssistant = { ...currentAssistant };
        out[idx] = currentAssistant;
      }
      continue;
    }

    if (isAnswerEnd(e)) {
      if (currentAssistant) {
        currentAssistant.content = e.payload.text || currentAssistant.content;
        currentAssistant.isStreaming = false;
        const idx = out.indexOf(currentAssistant);
        if (idx >= 0) {
          currentAssistant = { ...currentAssistant };
          out[idx] = currentAssistant;
        }
        currentAssistant = null;
      }
      continue;
    }

    if (isToolCall(e)) {
      out.push({
        id: `tool-call-${e.eventId}`,
        role: "tool",
        content: e.payload.name,
        toolName: e.payload.name,
        toolInput: e.payload.input,
        timestamp: Date.parse(e.createdAt),
      });
      continue;
    }

    if (isToolResult(e)) {
      for (let i = out.length - 1; i >= 0; i--) {
        const m = out[i]!;
        if (
          m.role === "tool" &&
          m.toolName === e.payload.name &&
          !m.toolResult &&
          !m.toolError
        ) {
          out[i] = {
            ...m,
            toolResult: e.payload.result,
            toolError: e.payload.error,
          };
          break;
        }
      }
      continue;
    }

    if (isSubagentStart(e)) {
      const msg: ChatMessage = {
        id: `sub-${e.payload.subId}`,
        role: "assistant",
        content: `[${e.payload.role}] ${e.payload.task}`,
        timestamp: Date.parse(e.createdAt),
        subAgentId: e.payload.subId,
        subAgentRole: e.payload.role,
      };
      out.push(msg);
      continue;
    }

    if (isSourcesFound(e)) {
      if (currentAssistant) {
        const idx = out.indexOf(currentAssistant);
        if (idx >= 0) {
          currentAssistant = { ...currentAssistant, sources: e.payload.sources };
          out[idx] = currentAssistant;
        }
      } else {
        pendingSources = e.payload.sources;
        for (let i = out.length - 1; i >= 0; i--) {
          const m = out[i]!;
          if (m.role === "user") {
            out[i] = { ...m, sources: e.payload.sources };
            break;
          }
        }
      }
      continue;
    }

    if (isFrontendCall(e)) {
      if (
        e.payload.name === "show_related" &&
        e.payload.input &&
        typeof e.payload.input === "object" &&
        "questions" in e.payload.input &&
        Array.isArray((e.payload.input as { questions: unknown }).questions) &&
        currentAssistant
      ) {
        const questions = (
          e.payload.input as { questions: unknown[] }
        ).questions.map(String);
        const idx = out.indexOf(currentAssistant);
        if (idx >= 0) {
          const updated: ChatMessage = { ...out[idx]!, related: questions };
          out[idx] = updated;
          currentAssistant = updated;
        }
      }
      continue;
    }

    if (isDone(e)) {
      // Mark the last assistant message as done + attach sources/related.
      for (let i = out.length - 1; i >= 0; i--) {
        const m = out[i]!;
        if (m.role === "assistant" && !m.subAgentId) {
          out[i] = {
            ...m,
            isStreaming: false,
            sources: m.sources ?? e.payload.sources ?? undefined,
            related: m.related ?? e.payload.related ?? undefined,
          };
          break;
        }
      }
      if (currentAssistant) {
        currentAssistant.isStreaming = false;
        currentAssistant.sources =
          currentAssistant.sources ?? e.payload.sources ?? undefined;
        currentAssistant.related =
          currentAssistant.related ?? e.payload.related ?? undefined;
        const idx = out.indexOf(currentAssistant);
        if (idx >= 0) {
          currentAssistant = { ...currentAssistant };
          out[idx] = currentAssistant;
        }
        currentAssistant = null;
      }
      pendingSources = null;
      continue;
    }

    if (isErrorEvent(e)) {
      // Surface errors as a synthetic assistant message so users see them.
      out.push({
        id: `error-${e.eventId}`,
        role: "assistant",
        content: `Error: ${e.payload.message}`,
        timestamp: Date.parse(e.createdAt),
      });
      continue;
    }
    // Other events (think.*, plan.*, checkpoint, subagent.end,
    // paused, anvil.dropped, ready) don't produce chat messages.
  }

  return out;
}

// ── Thread-history hydration (TurnRecord[] → AgentState + messages) ─

/**
 * Build a synthetic event sequence from a `TurnRecord[]` so the same
 * reducers (`reduceAgentStateFromEvents`, `reduceEventsToMessages`)
 * work for both live streaming AND thread replay.
 *
 * Each turn contributes:
 *   1. session.start — opens the turn with task / thread id
 *   2. plan.set — if the turn has a final plan
 *   3. think.chunk + think.end — if the turn has reasoning
 *   4. plan.step — one per entry in `turn.steps`
 *   5. sources.found — if the turn has sources
 *   6. answer.chunk + answer.end — full answer in one chunk
 *   7. done — closes the turn
 *
 * Event ids are derived from the turn index + step index to keep them
 * unique and ordered.
 */
function turnToEvents(turn: TurnRecord, startId: number): AnvilEvent[] {
  const events: AnvilEvent[] = [];
  let nextId = startId;

  const push = (
    type: AnvilEvent["type"],
    payload: unknown,
    extra: Partial<Pick<AnvilEvent, "threadId">> = {},
  ): AnvilEvent =>
    ({
      eventId: nextId++,
      type,
      sessionId: turn.sessionId,
      threadId: extra.threadId ?? turn.threadId,
      payload,
      createdAt: turn.startedAt,
    }) as AnvilEvent;

  events.push(
    push("session.start", {
      task: turn.question,
      threadId: turn.threadId,
      focus: undefined,
    }),
  );

  if (turn.plan) {
    events.push(
      push("plan.set", {
        plan: {
          reason: turn.plan.reason,
          synthesizeHint: turn.plan.synthesizeHint,
          needsSearch: turn.plan.needsSearch,
          subQueries: turn.plan.subQueries,
        },
      }),
    );
  }

  if (turn.reasoning) {
    events.push(push("think.chunk", { delta: turn.reasoning }));
    events.push(push("think.end", { text: turn.reasoning }));
  }

  if (turn.steps) {
    for (const step of turn.steps) {
      events.push(push("plan.step", { step }));
    }
  }

  if (turn.sources && turn.sources.length > 0) {
    events.push(push("sources.found", { sources: turn.sources }));
  }

  if (turn.answer) {
    events.push(push("answer.chunk", { delta: turn.answer }));
    events.push(push("answer.end", { text: turn.answer }));
  }

  if (turn.error) {
    events.push(push("error", turn.error));
  }

  events.push(
    push("done", {
      answer: turn.answer,
      sources: turn.sources,
      related: turn.related,
      plan: turn.plan,
      reason: turn.doneReason,
    }),
  );

  return events;
}

/**
 * Build the full event sequence for an entire thread (one event log
 * covering all turns). The React SDK treats this as if it were a live
 * stream — same `useAgentState`, same `useChat`, same components.
 */
export function threadToEvents(turns: TurnRecord[]): AnvilEvent[] {
  const events: AnvilEvent[] = [];
  let nextId = 1;
  for (const turn of turns) {
    events.push(...turnToEvents(turn, nextId));
    nextId += 16; // leave headroom per turn for future events
  }
  return events;
}

/**
 * Direct reducer: turn records → AgentState for the most recent turn.
 * Useful when the UI wants to render the last turn's thinking state
 * without subscribing to events.
 */
export function agentStateFromTurns(turns: TurnRecord[]): AgentState {
  return reduceAgentStateFromEvents(threadToEvents(turns));
}

/**
 * Direct reducer: turn records → ChatMessage[] for the full thread.
 */
export function messagesFromTurns(turns: TurnRecord[]): ChatMessage[] {
  return reduceEventsToMessages(threadToEvents(turns));
}

// Re-export types so callers can `import { ChatMessage, ... } from "@anvil/client"`.
export type { ChatMessage, PlanStep, AgentSource, TurnRecord };
export type { AgentState, AgentPhase, AgentPlan };