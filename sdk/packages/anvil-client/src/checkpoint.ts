/**
 * Checkpoint stores — LangGraph-style persistence for agent state.
 *
 * A "checkpoint" is a serializable snapshot of:
 *   - `AgentState` (phase, plan, sources, answer, extensions, ...)
 *   - `lastEventId` — the highest event id processed before the snapshot
 *   - `threadId` / `sessionId` — where this state belongs
 *   - `createdAt` — when the snapshot was taken
 *
 * Use it to:
 *   - Resume a session after a tab refresh (localStorage)
 *   - Replay a session from a known point
 *   - Sync state across browser tabs (BroadcastChannel)
 *
 * The TS stores mirror the Go side (`internal/core/checkpoint_factory.go`):
 *   - InMemory: lost on refresh, useful for testing
 *   - LocalStorage: browser-local persistence (the easy choice)
 *   - Remote: HTTP-backed, used when you want server-side state
 *   - Custom: your own (IndexedDB, OPFS, Redis-via-WS, ...)
 */

import type { AgentState } from "./types/agent-state";

// ── Types ────────────────────────────────────────────────────────────

/**
 * A checkpoint captures enough state to resume an agent session
 * without replaying every event. Designed to be JSON-serializable
 * so it can flow over HTTP, persist to disk, or travel through
 * postMessage.
 */
export interface Checkpoint {
  /** Owning session. */
  sessionId: string;
  /** Owning thread. */
  threadId: string;
  /** Highest event id included in this snapshot. */
  lastEventId: number;
  /** The full agent state at the moment of the snapshot. */
  state: AgentState;
  /** ISO-8601 timestamp of when this snapshot was created. */
  createdAt: string;
}

/**
 * The store interface. Three methods — small surface, easy to wrap.
 *
 * LangGraph analogy: this is the same shape as LangGraph's
 * `BaseCheckpointSaver` (get / put / list).
 */
export interface CheckpointStore {
  /** Persist a checkpoint. May overwrite prior versions for the same sessionId. */
  save(cp: Checkpoint): Promise<void>;
  /** Load the latest checkpoint for a session, or null if none exists. */
  load(sessionId: string): Promise<Checkpoint | null>;
  /** List all checkpoints for a thread (newest first). */
  list(threadId: string): Promise<Checkpoint[]>;
  /** Delete a checkpoint (e.g. when user clears their history). */
  remove(sessionId: string): Promise<void>;
}

/**
 * Configuration for `createCheckpointStore`. Pick a backend, or
 * pass `custom` for full control.
 */
export interface CheckpointStoreConfig {
  /** "memory" | "localStorage" | "remote" | "custom". Default: "memory". */
  type?: "memory" | "localStorage" | "remote" | "custom";

  /** localStorage key prefix. Default: "anvil_checkpoint_". */
  localStoragePrefix?: string;

  /** Required for type="remote". The endpoint that accepts POST/GET. */
  remoteUrl?: string;
  /** Optional fetch override for the remote store. */
  fetch?: typeof fetch;

  /** Required for type="custom". Your own CheckpointStore impl. */
  custom?: CheckpointStore;
}

// ── Helpers ──────────────────────────────────────────────────────────

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── In-memory ────────────────────────────────────────────────────────

/**
 * In-memory store. Useful for tests, SSR (no `localStorage`), and
 * short-lived agents where persistence doesn't matter. Data is lost
 * when the process exits.
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private map = new Map<string, Checkpoint>();
  private byThread = new Map<string, Set<string>>();

  async save(cp: Checkpoint): Promise<void> {
    this.map.set(cp.sessionId, cp);
    let set = this.byThread.get(cp.threadId);
    if (!set) {
      set = new Set();
      this.byThread.set(cp.threadId, set);
    }
    set.add(cp.sessionId);
  }

  async load(sessionId: string): Promise<Checkpoint | null> {
    return this.map.get(sessionId) ?? null;
  }

  async list(threadId: string): Promise<Checkpoint[]> {
    const set = this.byThread.get(threadId);
    if (!set) return [];
    const out: Checkpoint[] = [];
    for (const sid of set) {
      const cp = this.map.get(sid);
      if (cp) out.push(cp);
    }
    // Newest first by lastEventId (proxy for recency).
    return out.sort((a, b) => b.lastEventId - a.lastEventId);
  }

  async remove(sessionId: string): Promise<void> {
    const cp = this.map.get(sessionId);
    if (!cp) return;
    this.map.delete(sessionId);
    this.byThread.get(cp.threadId)?.delete(sessionId);
  }
}

// ── localStorage ────────────────────────────────────────────────────

/**
 * Browser-local persistence via `localStorage`. Survives tab
 * refreshes and restarts. Bound to the origin (not synced across
 * devices). Best default for most web apps.
 *
 * Schema:
 *   {prefix}{sessionId} → JSON Checkpoint
 *   {prefix}_index      → JSON { threadId → sessionId[] }
 */
export class LocalStorageCheckpointStore implements CheckpointStore {
  private prefix: string;

  constructor(prefix = "anvil_checkpoint_") {
    this.prefix = prefix;
  }

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  private indexKey(): string {
    return `${this.prefix}_index`;
  }

  private readIndex(): Record<string, string[]> {
    return safeParse(
      localStorage.getItem(this.indexKey()),
      {},
    );
  }

  private writeIndex(idx: Record<string, string[]>) {
    localStorage.setItem(this.indexKey(), JSON.stringify(idx));
  }

  async save(cp: Checkpoint): Promise<void> {
    try {
      localStorage.setItem(this.key(cp.sessionId), JSON.stringify(cp));
      const idx = this.readIndex();
      const list = idx[cp.threadId] ?? [];
      if (!list.includes(cp.sessionId)) {
        idx[cp.threadId] = [cp.sessionId, ...list];
        this.writeIndex(idx);
      }
    } catch (err) {
      // localStorage quota exceeded — surface but don't crash.
      console.warn("anvil: localStorage save failed", err);
    }
  }

  async load(sessionId: string): Promise<Checkpoint | null> {
    return safeParse(localStorage.getItem(this.key(sessionId)), null);
  }

  async list(threadId: string): Promise<Checkpoint[]> {
    const idx = this.readIndex();
    const ids = idx[threadId] ?? [];
    const out: Checkpoint[] = [];
    for (const id of ids) {
      const cp = await this.load(id);
      if (cp) out.push(cp);
    }
    return out.sort((a, b) => b.lastEventId - a.lastEventId);
  }

  async remove(sessionId: string): Promise<void> {
    localStorage.removeItem(this.key(sessionId));
    const idx = this.readIndex();
    for (const tid of Object.keys(idx)) {
      const before = idx[tid] ?? [];
      idx[tid] = before.filter((id) => id !== sessionId);
      if (idx[tid]!.length === 0) delete idx[tid];
    }
    this.writeIndex(idx);
  }
}

// ── Remote ───────────────────────────────────────────────────────────

/**
 * HTTP-backed store. Useful when:
 *   - You want server-side resume (user signs in on a new device)
 *   - You're deploying a managed agent backend
 *   - You're integrating with LangGraph Cloud / similar services
 *
 * Wire protocol (the server implements these endpoints):
 *   POST {remoteUrl}                       → save checkpoint
 *   GET  {remoteUrl}/sessions/{id}         → load checkpoint
 *   GET  {remoteUrl}/threads/{id}          → list checkpoints
 *   DELETE {remoteUrl}/sessions/{id}       → remove checkpoint
 */
export class RemoteCheckpointStore implements CheckpointStore {
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async save(cp: Checkpoint): Promise<void> {
    const r = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cp),
    });
    if (!r.ok) throw new Error(`save checkpoint failed: ${r.status}`);
  }

  async load(sessionId: string): Promise<Checkpoint | null> {
    const r = await this.fetchImpl(
      `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}`,
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`load checkpoint failed: ${r.status}`);
    return (await r.json()) as Checkpoint;
  }

  async list(threadId: string): Promise<Checkpoint[]> {
    const r = await this.fetchImpl(
      `${this.baseUrl}/threads/${encodeURIComponent(threadId)}`,
    );
    if (!r.ok) throw new Error(`list checkpoints failed: ${r.status}`);
    return (await r.json()) as Checkpoint[];
  }

  async remove(sessionId: string): Promise<void> {
    const r = await this.fetchImpl(
      `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    if (!r.ok) throw new Error(`remove checkpoint failed: ${r.status}`);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create a CheckpointStore from a config. Mirrors the Go factory
 * `core.NewCheckpointStore` so the surface is consistent across
 * languages.
 *
 * ```ts
 * // Memory (tests, short-lived):
 * const store = createCheckpointStore({ type: "memory" });
 *
 * // LocalStorage (default for browser apps):
 * const store = createCheckpointStore({ type: "localStorage" });
 *
 * // Remote (server-side persistence):
 * const store = createCheckpointStore({ type: "remote", remoteUrl: "/api/checkpoints" });
 *
 * // Custom (IndexedDB, OPFS, etc):
 * const store = createCheckpointStore({ type: "custom", custom: myStore });
 * ```
 */
export function createCheckpointStore(
  config: CheckpointStoreConfig = {},
): CheckpointStore {
  const type = config.type ?? "memory";
  switch (type) {
    case "memory":
      return new InMemoryCheckpointStore();
    case "localStorage":
      return new LocalStorageCheckpointStore(config.localStoragePrefix);
    case "remote":
      if (!config.remoteUrl) {
        throw new Error("createCheckpointStore: remoteUrl required for type=remote");
      }
      return new RemoteCheckpointStore(config.remoteUrl, config.fetch);
    case "custom":
      if (!config.custom) {
        throw new Error("createCheckpointStore: custom store required for type=custom");
      }
      return config.custom;
    default:
      throw new Error(
        `createCheckpointStore: unknown type ${String(type)} (want memory | localStorage | remote | custom)`,
      );
  }
}

// ── Convenience helpers ──────────────────────────────────────────────

/**
 * Capture a checkpoint from an event log + initial state. The agent
 * can rebuild the full state via `reduceAgentStateFromEvents(events)`,
 * but the checkpoint only needs to capture the END state (everything
 * up to `lastEventId`) plus that id.
 *
 * Use this in a `useEffect` or after `done` arrives.
 */
export function captureCheckpoint(opts: {
  sessionId: string;
  threadId: string;
  state: AgentState;
  lastEventId: number;
}): Checkpoint {
  return {
    sessionId: opts.sessionId,
    threadId: opts.threadId,
    state: opts.state,
    lastEventId: opts.lastEventId,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Resume a session from a checkpoint. Returns the loaded state or
 * null if no checkpoint exists.
 *
 * Usage:
 * ```ts
 * const store = createCheckpointStore({ type: "localStorage" });
 * const cp = await resumeFromCheckpoint(store, sessionId);
 * if (cp) {
 *   setSharedEvents([
 *     // Synthetic event so the reducer starts at the right place
 *     { type: "session.start", sessionId, ... },
 *     // + any events you've replayed from the server via Since=cp.lastEventId
 *   ]);
 * }
 * ```
 */
export async function resumeFromCheckpoint(
  store: CheckpointStore,
  sessionId: string,
): Promise<Checkpoint | null> {
  return store.load(sessionId);
}

// Re-export for tests + small utility uses.
export { delay };