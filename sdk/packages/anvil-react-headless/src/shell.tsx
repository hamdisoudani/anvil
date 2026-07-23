"use client";

/**
 * <AnvilShell> + `useAnvilShell()` — pluggable storage + routing primitives.
 *
 * The shell is the OUTER layer of an agent UI. It owns:
 *   - thread persistence (where do threads live?)
 *   - URL routing (how do users navigate between threads?)
 *   - thread metadata (titles, timestamps)
 *
 * Defaults: localStorage + URL hash. Override either with a custom
 * backend (Postgres, Supabase, in-memory test fixtures) or custom
 * router (pathname, query string, no routing at all).
 *
 * ```tsx
 * // Minimal — uses defaults
 * <AnvilShell>
 *   <ChatUI agent={agent} />
 * </AnvilShell>
 *
 * // Custom storage + routing
 * <AnvilShell
 *   storage={{
 *     loadThread: async (id) => await db.threads.get(id),
 *     saveThread: async (id, meta) => await db.threads.put(id, meta),
 *     listThreads: async () => await db.threads.all(),
 *     deleteThread: async (id) => await db.threads.delete(id),
 *   }}
 *   routing={{
 *     getThreadId: () => new URL(window.location.href).pathname.split('/').pop() ?? null,
 *     navigateToThread: (id) => history.pushState(null, '', `/threads/${id}`),
 *   }}
 * >
 *   <ChatUI agent={agent} />
 * </AnvilShell>
 * ```
 *
 * The shell calls its backend whenever the user switches threads,
 * mounts, or creates a new thread. Consumers (ChatUI, ThreadList,
 * etc.) consume via the `useAnvilShell()` hook.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatMessage } from "./index";

// ── Types ────────────────────────────────────────────────────────────

/** Metadata for a thread (shown in the sidebar). */
export interface ThreadMeta {
  id: string;
  title: string;
  timestamp: number;
}

/** Hydrated thread — messages + metadata. Returned by `loadThread`. */
export interface ThreadData extends ThreadMeta {
  messages: ChatMessage[];
}

/**
 * Pluggable persistence backend. All methods are async so the same
 * interface supports localStorage (fast, sync wrapped in Promise.resolve)
 * and remote databases (Postgres, Supabase, etc).
 *
 * If a method is omitted, the shell falls back to the default
 * localStorage impl for that method.
 */
export interface ShellStorage {
  loadThread?: (id: string) => Promise<ThreadData | null>;
  saveThread?: (id: string, meta: ThreadMeta, messages: ChatMessage[]) => Promise<void>;
  listThreads?: () => Promise<ThreadMeta[]>;
  deleteThread?: (id: string) => Promise<void>;
}

/**
 * Pluggable URL routing. If omitted, the shell uses hash routing
 * (#/thread/<id>) — same as the original AnvilPerplexity behavior.
 */
export interface ShellRouting {
  getThreadId?: () => string | null;
  navigateToThread?: (id: string) => void;
  navigateToHome?: () => void;
  /** Subscribe to browser navigation events (e.g. popstate). */
  subscribe?: (onChange: () => void) => () => void;
}

// ── Default implementations ─────────────────────────────────────────

const DEFAULT_THREADS_KEY = "anvil_threads";
const threadMessagesKey = (id: string) => `anvil_thread_messages_${id}`;

const defaultLoadThread = async (id: string): Promise<ThreadData | null> => {
  if (typeof window === "undefined") return null;
  try {
    const meta = JSON.parse(localStorage.getItem(DEFAULT_THREADS_KEY) || "[]") as ThreadMeta[];
    const m = meta.find((t) => t.id === id);
    if (!m) return null;
    const messages = JSON.parse(
      localStorage.getItem(threadMessagesKey(id)) || "[]",
    ) as ChatMessage[];
    return { ...m, messages };
  } catch {
    return null;
  }
};

const defaultSaveThread = async (
  id: string,
  meta: ThreadMeta,
  messages: ChatMessage[],
): Promise<void> => {
  if (typeof window === "undefined") return;
  const all = JSON.parse(localStorage.getItem(DEFAULT_THREADS_KEY) || "[]") as ThreadMeta[];
  const filtered = all.filter((t) => t.id !== id);
  filtered.unshift(meta);
  localStorage.setItem(
    DEFAULT_THREADS_KEY,
    JSON.stringify(filtered.slice(0, 50)),
  );
  localStorage.setItem(threadMessagesKey(id), JSON.stringify(messages));
};

const defaultListThreads = async (): Promise<ThreadMeta[]> => {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(DEFAULT_THREADS_KEY) || "[]");
  } catch {
    return [];
  }
};

const defaultDeleteThread = async (id: string): Promise<void> => {
  if (typeof window === "undefined") return;
  const all = JSON.parse(localStorage.getItem(DEFAULT_THREADS_KEY) || "[]") as ThreadMeta[];
  localStorage.setItem(
    DEFAULT_THREADS_KEY,
    JSON.stringify(all.filter((t) => t.id !== id)),
  );
  localStorage.removeItem(threadMessagesKey(id));
};

const defaultGetThreadId = (): string | null => {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#\/thread\/(.+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
};

const defaultNavigateToThread = (id: string): void => {
  if (typeof window === "undefined") return;
  window.history.pushState(null, "", `/#/thread/${encodeURIComponent(id)}`);
};

const defaultNavigateToHome = (): void => {
  if (typeof window === "undefined") return;
  window.history.pushState(null, "", "/");
};

// ── Context ─────────────────────────────────────────────────────────

export interface AnvilShellContextValue {
  /** Current thread id (null = no thread active). */
  threadId: string | null;
  /** Hydrated messages for the current thread (before any live events). */
  hydratedMessages: ChatMessage[];
  /** All known threads (sorted newest-first). */
  threads: ThreadMeta[];
  /** Switch to a thread (loads from storage + updates URL). */
  switchToThread: (id: string) => Promise<void>;
  /** Start a new thread (clears state + navigates home). */
  startNewThread: () => void;
  /** Save the current thread's metadata + messages. */
  saveCurrentThread: (title: string, messages: ChatMessage[]) => Promise<void>;
  /** Delete a thread. */
  deleteThread: (id: string) => Promise<void>;
  /** Reload thread list (e.g. after a delete). */
  refreshThreads: () => Promise<void>;
}

const AnvilShellContext = createContext<AnvilShellContextValue | null>(null);

/**
 * Read the current shell state. Throws if used outside <AnvilShell>.
 */
export function useAnvilShell(): AnvilShellContextValue {
  const ctx = useContext(AnvilShellContext);
  if (!ctx) {
    throw new Error("useAnvilShell must be used inside <AnvilShell>");
  }
  return ctx;
}

/**
 * Optional version: returns null outside the shell. Useful for
 * components that work both with and without a shell (e.g. a
 * ChatUI that auto-saves to localStorage even without a shell,
 * but uses a remote DB when one is configured).
 */
export function useAnvilShellOptional(): AnvilShellContextValue | null {
  return useContext(AnvilShellContext);
}

// ── <AnvilShell> ─────────────────────────────────────────────────────

export interface AnvilShellProps {
  children: ReactNode;
  storage?: ShellStorage;
  routing?: ShellRouting;
  /**
   * Called when the user navigates to a thread that doesn't exist
   * in storage. Use this to load from server / show a "not found"
   * UI. Default: empty shell.
   */
  onUnknownThread?: (id: string) => void;
}

/**
 * Outer wrapper that owns thread persistence + URL routing. Wrap
 * any chat UI (ChatUI, your custom <MyChat>, etc.) inside it.
 */
export function AnvilShell({
  children,
  storage = {},
  routing = {},
  onUnknownThread,
}: AnvilShellProps) {
  // Resolve effective backend (override or default)
  const loadThread = storage.loadThread ?? defaultLoadThread;
  const saveThread = storage.saveThread ?? defaultSaveThread;
  const listThreads = storage.listThreads ?? defaultListThreads;
  const deleteThread = storage.deleteThread ?? defaultDeleteThread;
  const getThreadId = routing.getThreadId ?? defaultGetThreadId;
  const navigateToThread = routing.navigateToThread ?? defaultNavigateToThread;
  const navigateToHome = routing.navigateToHome ?? defaultNavigateToHome;
  const subscribe =
    routing.subscribe ??
    ((onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("popstate", onChange);
      window.addEventListener("hashchange", onChange);
      return () => {
        window.removeEventListener("popstate", onChange);
        window.removeEventListener("hashchange", onChange);
      };
    });

  const [threadId, setThreadId] = useState<string | null>(() => getThreadId());
  const [hydratedMessages, setHydratedMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const threadIdRef = useRef<string | null>(threadId);
  threadIdRef.current = threadId;

  const refreshThreads = useCallback(async () => {
    const t = await listThreads();
    setThreads(t);
  }, [listThreads]);

  const switchToThread = useCallback(
    async (id: string) => {
      setThreadId(id);
      threadIdRef.current = id;
      navigateToThread(id);
      const data = await loadThread(id);
      if (data) {
        setHydratedMessages(data.messages);
      } else {
        setHydratedMessages([]);
        onUnknownThread?.(id);
      }
    },
    [loadThread, navigateToThread, onUnknownThread],
  );

  const startNewThread = useCallback(() => {
    setThreadId(null);
    threadIdRef.current = null;
    setHydratedMessages([]);
    navigateToHome();
  }, [navigateToHome]);

  const saveCurrentThread = useCallback(
    async (title: string, messages: ChatMessage[]) => {
      const id = threadIdRef.current;
      if (!id) return;
      const meta: ThreadMeta = {
        id,
        title: title.slice(0, 80),
        timestamp: Date.now(),
      };
      await saveThread(id, meta, messages);
      await refreshThreads();
    },
    [saveThread, refreshThreads],
  );

  const deleteThreadById = useCallback(
    async (id: string) => {
      await deleteThread(id);
      if (threadIdRef.current === id) {
        startNewThread();
      }
      await refreshThreads();
    },
    [deleteThread, startNewThread, refreshThreads],
  );

  // Initial load + subscribe to URL changes (browser back/forward)
  useEffect(() => {
    void refreshThreads();
    const initial = getThreadId();
    if (initial) {
      void switchToThread(initial);
    }
    const unsub = subscribe(() => {
      const tid = getThreadId();
      if (tid !== threadIdRef.current) {
        if (tid) {
          void switchToThread(tid);
        } else {
          startNewThread();
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AnvilShellContextValue>(
    () => ({
      threadId,
      hydratedMessages,
      threads,
      switchToThread,
      startNewThread,
      saveCurrentThread,
      deleteThread: deleteThreadById,
      refreshThreads,
    }),
    [
      threadId,
      hydratedMessages,
      threads,
      switchToThread,
      startNewThread,
      saveCurrentThread,
      deleteThreadById,
      refreshThreads,
    ],
  );

  return (
    <AnvilShellContext.Provider value={value}>
      {children}
    </AnvilShellContext.Provider>
  );
}