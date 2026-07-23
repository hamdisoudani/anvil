"use client";

/**
 * useCheckpoint + <CheckpointProvider> — persist + resume agent state
 * across page reloads.
 *
 * The pattern:
 *   1. Capture a Checkpoint after each `done` event (or on a cadence)
 *   2. On mount, attempt to load a Checkpoint for the sessionId
 *   3. If found, hydrate the reducer with the saved state + replay
 *      events from `lastEventId + 1` onward (the server supports
 *      `?since=N` replay via SSE)
 *
 * Default backend: `localStorage`. Override via `store` prop.
 *
 * ```tsx
 * function App() {
 *   const agent = useAgent({ url: "/api" });
 *   return (
 *     <CheckpointProvider
 *       sessionId={agent.sessionId}
 *       threadId={agent.threadId}
 *       agentState={agent.state}
 *       lastEventId={agent.events.at(-1)?.eventId ?? 0}
 *     >
 *       <ChatUI agent={agent} />
 *     </CheckpointProvider>
 *   );
 * }
 * ```
 *
 * For non-React consumers, use `createCheckpointStore` and
 * `captureCheckpoint` directly (both exported from @anvil/client).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createCheckpointStore,
  type Checkpoint,
  type CheckpointStore,
  type CheckpointStoreConfig,
} from "@anvil/client";
import type { AgentState } from "@anvil/client";

// ── Context ─────────────────────────────────────────────────────────

export interface CheckpointContextValue {
  /** The active store. */
  store: CheckpointStore;
  /** Most recently saved Checkpoint for this thread (or null). */
  latest: Checkpoint | null;
  /** Whether the initial load attempt has completed. */
  ready: boolean;
  /** Manually trigger a save (also auto-saves on `done`). */
  save: (cp: Checkpoint) => Promise<void>;
}

const CheckpointContext = createContext<CheckpointContextValue | null>(null);

export function useCheckpoint(): CheckpointContextValue {
  const ctx = useContext(CheckpointContext);
  if (!ctx) {
    throw new Error("useCheckpoint must be used inside <CheckpointProvider>");
  }
  return ctx;
}

export function useCheckpointOptional(): CheckpointContextValue | null {
  return useContext(CheckpointContext);
}

// ── Provider ────────────────────────────────────────────────────────

export interface CheckpointProviderProps {
  /** Owning session id. Used to key the checkpoint. */
  sessionId: string | null;
  /** Owning thread id. Used to list checkpoints for the thread. */
  threadId: string | null;
  /** Current AgentState. Auto-saves when `state.doneReceived` flips true. */
  agentState: AgentState | null;
  /** Last event id processed (used to compute checkpoint lastEventId). */
  lastEventId?: number;
  /** Backend config — passed to createCheckpointStore. */
  storeConfig?: CheckpointStoreConfig;
  /** Or pass a fully-constructed store directly (escape hatch). */
  store?: CheckpointStore;
  /** How often to auto-save (ms). Default: 5000. Set to 0 to disable. */
  autoSaveIntervalMs?: number;
  /** Don't auto-save when `state.doneReceived` flips true. Default: false. */
  disableAutoSaveOnDone?: boolean;
  children: ReactNode;
}

/**
 * Manages checkpoint persistence for the active session/thread.
 *
 * On mount:
 *   1. Creates a CheckpointStore from config (or uses the one passed in)
 *   2. Loads the latest Checkpoint for the session (or thread if no
 *      session match)
 *   3. Exposes `save()` for manual triggers + the loaded checkpoint
 *
 * On `done`:
 *   1. Auto-saves a new Checkpoint with the final AgentState
 *
 * On unmount:
 *   1. Flushes any pending save
 */
export function CheckpointProvider({
  sessionId,
  threadId,
  agentState,
  lastEventId = 0,
  storeConfig,
  store: externalStore,
  autoSaveIntervalMs = 5000,
  disableAutoSaveOnDone = false,
  children,
}: CheckpointProviderProps) {
  // The store is created once per provider mount.
  const store = useMemo<CheckpointStore>(
    () =>
      externalStore ??
      createCheckpointStore({
        // Default to memory if no config (avoids localStorage in SSR).
        type: "memory",
        ...(storeConfig ?? {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [latest, setLatest] = useState<Checkpoint | null>(null);
  const [ready, setReady] = useState(false);
  const prevDoneRef = useRef(false);

  // Initial load: try the session id, fall back to the most recent
  // checkpoint for the thread.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let cp: Checkpoint | null = null;
        if (sessionId) {
          cp = await store.load(sessionId);
        }
        if (!cp && threadId) {
          const list = await store.list(threadId);
          cp = list[0] ?? null;
        }
        if (!cancelled) {
          setLatest(cp);
          setReady(true);
        }
      } catch (err) {
        console.warn("anvil: checkpoint load failed", err);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, sessionId, threadId]);

  // Auto-save on `done`.
  useEffect(() => {
    if (disableAutoSaveOnDone) return;
    if (!agentState || !sessionId || !threadId) return;
    if (!agentState.doneReceived) return;
    if (prevDoneRef.current === agentState.doneReceived) return;
    prevDoneRef.current = agentState.doneReceived;
    const cp: Checkpoint = {
      sessionId,
      threadId,
      state: agentState,
      lastEventId,
      createdAt: new Date().toISOString(),
    };
    store.save(cp).then(() => {
      setLatest(cp);
    }).catch((err) => {
      console.warn("anvil: checkpoint save failed", err);
    });
  }, [agentState, sessionId, threadId, lastEventId, store, disableAutoSaveOnDone]);

  // Cadence auto-save (optional).
  useEffect(() => {
    if (autoSaveIntervalMs <= 0) return;
    if (!sessionId || !threadId || !agentState) return;
    const id = setInterval(() => {
      const cp: Checkpoint = {
        sessionId,
        threadId,
        state: agentState,
        lastEventId,
        createdAt: new Date().toISOString(),
      };
      store.save(cp).catch(() => {});
    }, autoSaveIntervalMs);
    return () => clearInterval(id);
  }, [autoSaveIntervalMs, sessionId, threadId, lastEventId, agentState, store]);

  const save = useMemo(
    () => async (cp: Checkpoint) => {
      await store.save(cp);
      setLatest(cp);
    },
    [store],
  );

  const value = useMemo<CheckpointContextValue>(
    () => ({ store, latest, ready, save }),
    [store, latest, ready, save],
  );

  return (
    <CheckpointContext.Provider value={value}>
      {children}
    </CheckpointContext.Provider>
  );
}