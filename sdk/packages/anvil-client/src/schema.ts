/**
 * Canonical Anvil wire-protocol schema.
 *
 * This is the SINGLE SOURCE OF TRUTH for the shape of every event the
 * agent emits and the client receives. Both server (Go) and client
 * (TypeScript) must conform to this contract.
 *
 * Design principles:
 *
 * 1. **Discriminated union via `type`.** Every event has a `type`
 *    literal. TypeScript can narrow payloads without runtime casts;
 *    runtime type guards (`isXxxEvent`) cover the JS / untyped case.
 *
 * 2. **Payloads are typed by event type.** No more `(e.payload as any)`
 *    inside the React SDK. The reducer functions consume the narrowed
 *    payload directly.
 *
 * 3. **Forward-compat without `string`.** Unknown event types arrive
 *    as `UnknownEvent`. Consumers must opt-in to handling the unknown
 *    explicitly (loud failure, not silent).
 *
 * 4. **Stable IDs.** `eventId` is monotonic across the entire engine,
 *    stable across resume/replay. `sessionId` is the parent session.
 *
 * 5. **Wire format.** Wire JSON mirrors the TypeScript types exactly.
 *    Snake_case is avoided on the wire — we use camelCase to match
 *    React/TS idioms. Server encodes with the same field names.
 *
 * Schema version: 1
 */

// ── Canonical event types (single source of truth) ──────────────────

export const EVENT_TYPES = [
  "session.start", // new session / turn started
  "think.start", // LLM thinking started
  "think.chunk", // streamed token (delta) — string fragment
  "think.end", // LLM thinking finished
  "plan.step", // agent transitioned into a plan step (intent / status)
  "plan.set", // full plan object delivered (sub-queries, reason)
  "sources.found", // discovered sources
  "answer.chunk", // streamed final-answer token
  "answer.end", // final answer finished
  "tool.call", // agent decided to call a tool
  "tool.result", // tool returned
  "frontend.call", // browser-side tool requested
  "subagent.start", // delegated to sub-agent
  "subagent.end", // sub-agent finished
  "checkpoint", // state snapshot saved
  "anvil.dropped", // server dropped events (subscriber slow)
  "subscriber.dropped", // explicit subscriber drop marker
  "error", // agent error
  "paused", // session paused, can resume
  "done", // terminal event
  // Control frames (not from agent)
  "ready", // SSE stream opened
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type UnknownEventType = string;

// ── Payload types ───────────────────────────────────────────────────

export interface SessionStartPayload {
  /** User task / question. */
  task: string;
  /** The owning thread. Different from session — one thread has many sessions. */
  threadId: string;
  /** Optional focus mode (web/academic/news/social). */
  focus?: string;
}

export interface ThinkStartPayload {
  /** Step index this think belongs to. */
  stepIndex: number;
}

export interface ThinkChunkPayload {
  /** Text fragment. Concatenation in order = full reasoning. */
  delta: string;
}

export interface ThinkEndPayload {
  /** Full reasoning text accumulated. */
  text: string;
  /** Token usage if reported. */
  tokens?: { input?: number; output?: number };
}

export interface AnswerChunkPayload {
  delta: string;
}

export interface AnswerEndPayload {
  /** Full final-answer text. */
  text: string;
}

/** A single sub-query in the agent's plan. */
export interface SubQuery {
  id: string;
  query: string;
  intent: string;
  source?: string;
  year?: number;
  dependsOn?: string[];
}

/** The plan delivered with `plan.set`. */
export interface PlanObject {
  /** Why the agent chose this plan. */
  reason?: string;
  /** Style guidance for the final synthesis (the synthesize_hint). */
  synthesizeHint?: string;
  /** Whether the agent decided to search at all. */
  needsSearch?: boolean;
  /** Decomposed sub-queries. */
  subQueries?: SubQuery[];
  /** Pass-through for unknown fields forwarded by the server. */
  [key: string]: unknown;
}

/** A single plan step transition. */
export interface PlanStep {
  /** Stable id (e.g. "s1"). */
  id: string;
  /** What the agent is trying to do (e.g. "Search the web for…"). */
  intent: string;
  /** Granular detail (e.g. "fetching result 3 of 7"). */
  detail?: string;
  /**
   * Status of this step.
   *
   * OPEN UNION: Standard values are `pending | running | done | error`
   * (autocomplete works for these). But you can emit custom statuses
   * from your backend (e.g. `awaiting_approval`, `awaiting_human_input`,
   * `retrying`) — the SDK accepts any string and your UI can branch
   * on the custom value.
   */
  status: "pending" | "running" | "done" | "error" | (string & {});
  /** Tool name (search, fetch_page, …). */
  tool?: string;
  /** Step index in the plan timeline. */
  index: number;
}

export interface PlanSetPayload {
  plan: PlanObject;
}

export interface PlanStepPayload {
  step: PlanStep;
}

export interface AgentSource {
  id: number;
  url: string;
  title: string;
  domain: string;
}

export interface SourcesFoundPayload {
  sources: AgentSource[];
}

export interface ToolCallPayload {
  /** Tool name. */
  name: string;
  /** Tool input arguments. */
  input: unknown;
  /** Optional call id (for matching tool_result). */
  callId?: string;
}

export interface ToolResultPayload {
  /** Tool name. */
  name: string;
  /** Call id this result matches. */
  callId?: string;
  /** Tool return value. */
  result: unknown;
  /** Error message if the tool failed. */
  error?: string;
}

export interface FrontendCallPayload {
  /** Frontend tool name. */
  name: string;
  /** Input from the agent. */
  input: unknown;
  /** Unique id for matching the response. */
  callId: string;
}

export interface SubagentStartPayload {
  subId: string;
  role: string;
  task: string;
}

export interface SubagentEndPayload {
  subId: string;
  output: unknown;
}

export interface CheckpointPayload {
  step: number;
}

export interface AnvilDroppedPayload {
  /** Number of events the server dropped. */
  count: number;
  /** Last id the subscriber received. */
  lastId: number;
}

export interface ErrorPayload {
  message: string;
  code?: string;
  severity?: "info" | "warning" | "error" | "fatal";
  /** True if the agent can continue after this error. */
  recoverable?: boolean;
  /** True if the user can retry the same request. */
  retryable?: boolean;
  /** ID of the plan.step that failed. */
  step_id?: string;
  /** Nested raw payload, surfaced for debugging. */
  raw?: unknown;
}

export interface DonePayload {
  /** Final answer text. */
  answer?: string;
  /** Sources cited. */
  sources?: AgentSource[];
  /** Related questions. */
  related?: string[];
  /** Final plan. */
  plan?: PlanObject;
  /** Terminal reason. */
  reason?: "completed" | "cancelled" | "max_steps" | "error";
  /** Number of steps taken. */
  steps?: number;
}

export interface PausedPayload {
  reason: string;
  resumeAt?: string;
}

export interface ReadyPayload {
  sessionId: string;
  resumeFromId?: number;
}

// ── Discriminated union ─────────────────────────────────────────────

/**
 * The full Anvil event. Wire-format shape mirrors this exactly.
 *
 * Every concrete event extends `BaseEvent` with a literal `type` and
 * a typed `payload` matching the event's payload schema.
 */
export interface BaseEvent<T extends EventType, P> {
  /** Monotonic across the engine, stable across resume. Wire: event_id. */
  eventId: number;
  /** Per-event type discriminator. */
  type: T;
  /** Owning session id. */
  sessionId: string;
  /** The owning thread. Omitted on session.start (the first event of a session). */
  threadId?: string;
  /** Payload — shape depends on `type`. */
  payload: P;
  /** ISO-8601 timestamp, wire: created_at. */
  createdAt: string;
}

export type SessionStartEvent = BaseEvent<"session.start", SessionStartPayload>;
export type ThinkStartEvent = BaseEvent<"think.start", ThinkStartPayload>;
export type ThinkChunkEvent = BaseEvent<"think.chunk", ThinkChunkPayload>;
export type ThinkEndEvent = BaseEvent<"think.end", ThinkEndPayload>;
export type PlanStepEvent = BaseEvent<"plan.step", PlanStepPayload>;
export type PlanSetEvent = BaseEvent<"plan.set", PlanSetPayload>;
export type SourcesFoundEvent = BaseEvent<"sources.found", SourcesFoundPayload>;
export type AnswerChunkEvent = BaseEvent<"answer.chunk", AnswerChunkPayload>;
export type AnswerEndEvent = BaseEvent<"answer.end", AnswerEndPayload>;
export type ToolCallEvent = BaseEvent<"tool.call", ToolCallPayload>;
export type ToolResultEvent = BaseEvent<"tool.result", ToolResultPayload>;
export type FrontendCallEvent = BaseEvent<"frontend.call", FrontendCallPayload>;
export type SubagentStartEvent = BaseEvent<"subagent.start", SubagentStartPayload>;
export type SubagentEndEvent = BaseEvent<"subagent.end", SubagentEndPayload>;
export type CheckpointEvent = BaseEvent<"checkpoint", CheckpointPayload>;
export type AnvilDroppedEvent = BaseEvent<"anvil.dropped", AnvilDroppedPayload>;
export type ErrorEvent = BaseEvent<"error", ErrorPayload>;
export type DoneEvent = BaseEvent<"done", DonePayload>;
export type PausedEvent = BaseEvent<"paused", PausedPayload>;
export type ReadyEvent = BaseEvent<"ready", ReadyPayload>;

/**
 * The full event union. Discriminated by `type` — TS narrows payloads
 * automatically inside `if (e.type === "plan.step") { e.payload.step }`.
 */
export type AnvilEvent =
  | SessionStartEvent
  | ThinkStartEvent
  | ThinkChunkEvent
  | ThinkEndEvent
  | PlanStepEvent
  | PlanSetEvent
  | SourcesFoundEvent
  | AnswerChunkEvent
  | AnswerEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | FrontendCallEvent
  | SubagentStartEvent
  | SubagentEndEvent
  | CheckpointEvent
  | AnvilDroppedEvent
  | ErrorEvent
  | DoneEvent
  | PausedEvent
  | ReadyEvent;

/**
 * Wire shape — exactly what the client receives / server emits.
 * Field names match `BaseEvent` (event_id, session_id, thread_id,
 * created_at) to match Go's encoding/json conventions.
 */
export interface AnvilEventWire {
  event_id: number;
  type: EventType | UnknownEventType;
  session_id: string;
  thread_id?: string;
  payload: unknown;
  created_at: string;
}

/**
 * Forward-compat fallback for events whose `type` is unknown to this
 * client. These arrive when the server ships a new event before the
 * client knows about it. The SDK MUST surface them (no silent swallow)
 * — typically via a console warning and a generic UI affordance.
 */
export interface UnknownAnvilEvent {
  eventId: number;
  type: string;
  sessionId: string;
  threadId?: string;
  payload: unknown;
  createdAt: string;
  _unknown: true;
}

export type AnyAnvilEvent = AnvilEvent | UnknownAnvilEvent;

// ── Client / subscription types ─────────────────────────────────────

/**
 * Lifecycle event emitted by the SSE subscription. Surface these to
 * the user via `onLifecycle` to show "Reconnecting…", "Offline",
 * "Reconnected" banners in the UI.
 */
export type SubscriptionLifecycle =
  /** Initial connection attempt started. */
  | { kind: "connecting"; attempt: number }
  /** Connection established — events are flowing. */
  | { kind: "open"; attempt: number; resumedFrom: number }
  /**
   * Connection lost; retrying after `delayMs`. `attempt` is the
   * attempt that JUST failed (so the next attempt will be attempt+1).
   */
  | { kind: "reconnecting"; attempt: number; delayMs: number; cause: string }
  /** Permanently failed — `maxAttempts` reached. UI should show offline. */
  | { kind: "failed"; attempts: number; cause: string }
  /** User called `unsubscribe()`. */
  | { kind: "closed" };

/**
 * Reconnection strategy. Defaults:
 *   - initial delay:        1000ms
 *   - max delay:            30000ms (cap the exponential)
 *   - backoff multiplier:   2x
 *   - jitter:               0.5 (50% of computed delay — random)
 *   - max attempts:         Infinity (never give up by default)
 *
 * Set `maxAttempts` to a finite number for strict environments (e.g.
 * a CI test that needs to surface failures as errors).
 */
export interface ReconnectOptions {
  /** First delay before retrying. Default 1000ms. */
  initialDelayMs?: number;
  /** Cap on the per-attempt delay. Default 30000ms. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay on each failure. Default 2. */
  backoffMultiplier?: number;
  /**
   * Jitter factor in [0, 1). The actual delay becomes
   * `computed * (1 - jitter + jitter * random())`. Default 0.5 —
   * spreads retries across clients to avoid the thundering herd
   * when a flaky network comes back for many subscribers at once.
   */
  jitter?: number;
  /**
   * Max attempts before giving up. Default Infinity — the SSE
   * stream stays open forever (typical browser UX). Set to a
   * finite number when you want to surface hard failures (CI,
   * integration tests, embedded viewers that should stop and
   * let the user retry manually).
   */
  maxAttempts?: number;
}

/** Configuration for the Anvil HTTP/SSE client. */
export interface ClientConfig {
  /** Base URL of the Anvil HTTP server. */
  baseUrl: string;
  /** Custom fetch impl (for SSR, tests, or auth headers). */
  fetch?: typeof fetch;
  /** Custom EventSource impl (for Node tests). */
  EventSource?: typeof EventSource;
  /** Called when a server-side drop is detected. */
  onServerDrop?: (event: AnvilEvent) => void;
  /** Called when a subscriber drop marker arrives. */
  onSubscriberDrop?: (event: AnvilEvent) => void;
  /** Reconnection tuning (backoff, jitter, max attempts). */
  reconnect?: ReconnectOptions;
  /**
   * Subscribe to SSE lifecycle events. Useful for showing
   * "Reconnecting…" / "Offline" indicators in the UI.
   */
  onLifecycle?: (event: SubscriptionLifecycle) => void;
}

/**
 * Subscription handle returned by `AnvilClient.subscribe`.
 *
 * Note: `state()` now reports a broader lifecycle than the original
 * `connecting | open | closed`. The string values are unchanged for
 * backward compat; the new states are reachable via `onLifecycle`.
 */
export interface Subscription {
  unsubscribe: () => void;
  count: () => number;
  lastEventId: () => number;
  state: () => "connecting" | "open" | "closed";
  /** Latest attempt number (1-based). Useful for UI badges. */
  attempt: () => number;
}

/** Live status snapshot for an in-flight session. */
export interface SessionStatus {
  sessionId: string;
  step: number;
  subCount: number;
}

/** A pending frontend-tool call awaiting browser execution. */
export interface FrontendToolCall<TInput = unknown> {
  callId: string;
  name: string;
  input: TInput;
}

// ── Wire → typed mapper ─────────────────────────────────────────────

/**
 * Map the raw wire shape to the discriminated union. Unknown event
 * types are wrapped in `UnknownAnvilEvent` so consumers can't
 * accidentally crash on them.
 */
export function fromWire(wire: AnvilEventWire): AnyAnvilEvent {
  const known = (EVENT_TYPES as readonly string[]).includes(wire.type);
  if (known) {
    return {
      eventId: wire.event_id,
      type: wire.type as EventType,
      sessionId: wire.session_id,
      threadId: wire.thread_id,
      payload: wire.payload,
      createdAt: wire.created_at,
    } as AnvilEvent;
  }
  return {
    eventId: wire.event_id,
    type: wire.type,
    sessionId: wire.session_id,
    threadId: wire.thread_id,
    payload: wire.payload,
    createdAt: wire.created_at,
    _unknown: true as const,
  } satisfies UnknownAnvilEvent;
}

/**
 * Map a discriminated union event back to wire shape (for testing,
 * synthetic event injection, or local replay).
 */
export function toWire(e: AnyAnvilEvent): AnvilEventWire {
  return {
    event_id: e.eventId,
    type: e.type,
    session_id: e.sessionId,
    thread_id: e.threadId,
    payload: e.payload,
    created_at: e.createdAt,
  };
}

// ── Runtime type guards ─────────────────────────────────────────────
//
// These are the canonical way to discriminate events at runtime. They
// pair with `if (isX(e)) { e.payload.foo }` narrowing.

export const isEvent = <T extends EventType>(type: T) =>
  (e: AnyAnvilEvent): e is Extract<AnvilEvent, { type: T }> =>
    !("_unknown" in e) && e.type === type;

export const isSessionStart = isEvent("session.start");
export const isThinkStart = isEvent("think.start");
export const isThinkChunk = isEvent("think.chunk");
export const isThinkEnd = isEvent("think.end");
export const isPlanStep = isEvent("plan.step");
export const isPlanSet = isEvent("plan.set");
export const isSourcesFound = isEvent("sources.found");
export const isAnswerChunk = isEvent("answer.chunk");
export const isAnswerEnd = isEvent("answer.end");
export const isToolCall = isEvent("tool.call");
export const isToolResult = isEvent("tool.result");
export const isFrontendCall = isEvent("frontend.call");
export const isSubagentStart = isEvent("subagent.start");
export const isSubagentEnd = isEvent("subagent.end");
export const isCheckpoint = isEvent("checkpoint");
export const isAnvilDropped = isEvent("anvil.dropped");
export const isErrorEvent = isEvent("error");
export const isDone = isEvent("done");
export const isPaused = isEvent("paused");
export const isReady = isEvent("ready");

// ── High-level helpers ───────────────────────────────────────────────

/**
 * Is this event part of the "live" agent thinking stream? (think.* /
 * plan.* / sources.found). Useful for showing spinners.
 */
export function isThinkingEvent(e: AnyAnvilEvent): boolean {
  return (
    isThinkStart(e) ||
    isThinkChunk(e) ||
    isThinkEnd(e) ||
    isPlanStep(e) ||
    isPlanSet(e) ||
    isSourcesFound(e)
  );
}

/** Is this the streaming answer (the user-visible response)? */
export function isAnswerEvent(e: AnyAnvilEvent): boolean {
  return isAnswerChunk(e) || isAnswerEnd(e);
}

// ── Chat message view-model ────────────────────────────────────────

/**
 * Chat-style view of an event log. Produced by the reducer in
 * `./reducers` (`reduceEventsToMessages`) and consumed by
 * `useChat`. The same shape applies whether the reducer was fed a
 * live event stream OR a hydrated thread history — components don't
 * need to know.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolError?: string;
  timestamp: number;
  isStreaming?: boolean;
  subAgentId?: string;
  subAgentRole?: string;
  /** Sources cited by this message (assistant only). */
  sources?: AgentSource[];
  /** Related questions (assistant only). */
  related?: string[];
}

// ── History / persistence ───────────────────────────────────────────

/**
 * Persisted per-turn record used by /perplexity/thread/:id to
 * reconstruct full agent state when reloading a thread.
 *
 * This carries EVERYTHING the React SDK needs to rehydrate both
 * `useChat` (messages) and `useAgentState` (agent state) WITHOUT
 * requiring a replay of every event.
 */
export interface TurnRecord {
  /** Stable id (uuid). */
  id: string;
  /** Owning thread. */
  threadId: string;
  /** Owning session. */
  sessionId: string;
  /** User question. */
  question: string;
  /** Final answer text. */
  answer: string;
  /** ISO-8601 timestamp of session.start. */
  startedAt: string;
  /** ISO-8601 timestamp of done. Omitted if session crashed. */
  endedAt?: string;
  /** Available on done. */
  sources?: AgentSource[];
  /** Available on done. */
  related?: string[];
  /** Available on done. */
  plan?: PlanObject;
  /** Full timeline of plan.step events — for AgentThinking. */
  steps?: PlanStep[];
  /** Accumulated reasoning text from think.chunk / think.end. */
  reasoning?: string;
  /** Per-turn error if any. */
  error?: ErrorPayload;
  /** Terminal reason from done. */
  doneReason?: DonePayload["reason"];
}

/**
 * Response shape for `GET /perplexity/thread/:id`. Replaces the old
 * `(messages: [{role, content}])` payload which couldn't be used to
 * rehydrate agent state.
 */
export interface ThreadHistoryResponse {
  threadId: string;
  /** Session ids in chronological order. */
  sessionIds: string[];
  /** One entry per turn (one per assistant final answer). */
  turns: TurnRecord[];
}

import type {
  AgentState,
} from "./types/agent-state";
import type { PlanSubQuery } from "./types/agent-state";

// Re-export so callers can `import { AgentState, PlanSubQuery } from "@anvil/client"`.
export type { AgentState, PlanSubQuery };
export { INITIAL_AGENT_STATE } from "./types/agent-state";