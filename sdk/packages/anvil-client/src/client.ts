/**
 * AnvilClient — HTTP + SSE client for the Anvil wire protocol.
 *
 * Implements the canonical schema (see `./schema`) and handles
 * reconnection with `Last-Event-ID` so subscribers never miss events.
 *
 * Reconnect strategy: when the EventSource drops, we close it and
 * reconnect with `?since=<lastEventId>` so the server replays the
 * missed tail. The native EventSource `auto-reconnect` would lose the
 * `since=` query parameter, so we drive it manually.
 */

import {
  EVENT_TYPES,
  type AnvilEventWire,
  type ClientConfig,
  type Subscription,
  type FrontendToolCall,
  type SessionStatus,
  type ThreadHistoryResponse,
  fromWire,
} from "./schema";

export class AnvilClient {
  private config: Required<ClientConfig>;

  constructor(config: ClientConfig) {
    this.config = {
      fetch: config.fetch ?? fetch.bind(globalThis),
      EventSource:
        config.EventSource ??
        ((globalThis as unknown as { EventSource: typeof EventSource })
          .EventSource),
      onServerDrop: config.onServerDrop ?? (() => {}),
      onSubscriberDrop: config.onSubscriberDrop ?? (() => {}),
      baseUrl: config.baseUrl.replace(/\/$/, ""),
    };
  }

  /**
   * Start a new agent task (optionally continuing an existing thread).
   *
   * Pass `opts.threadId` to continue an existing conversation thread;
   * the server will create a fresh session bound to that thread and
   * the new session's events will be appended to the thread's history.
   */
  async startTask(
    task: string,
    opts?: { threadId?: string; focus?: string },
  ): Promise<{ sessionId: string; threadId: string; streamUrl: string }> {
    const body: Record<string, string> = { task, question: task };
    if (opts?.threadId) body.thread_id = opts.threadId;
    if (opts?.focus) body.focus = opts.focus;
    const r = await this.config.fetch(`${this.config.baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok)
      throw new Error(`startTask failed: ${r.status} ${await r.text()}`);
    const json = (await r.json()) as {
      session_id: string;
      thread_id?: string;
      stream_url: string;
    };
    return {
      sessionId: json.session_id,
      threadId: json.thread_id ?? json.session_id,
      streamUrl: json.stream_url,
    };
  }

  /** Resume a paused session. */
  async resume(
    sessionId: string,
  ): Promise<{ sessionId: string; streamUrl: string }> {
    const r = await this.config.fetch(
      `${this.config.baseUrl}/sessions/${sessionId}/resume`,
      { method: "POST" },
    );
    if (!r.ok) throw new Error(`resume failed: ${r.status} ${await r.text()}`);
    const body = (await r.json()) as { session_id: string; stream_url: string };
    return { sessionId: body.session_id, streamUrl: body.stream_url };
  }

  /** Get current session status. */
  async status(sessionId: string): Promise<SessionStatus> {
    const r = await this.config.fetch(
      `${this.config.baseUrl}/sessions/${sessionId}/status`,
    );
    if (!r.ok) throw new Error(`status failed: ${r.status}`);
    return r.json();
  }

  /**
   * Deliver a frontend tool result back to the engine.
   * Called by the browser-side executor when it finishes a FrontendTool.
   */
  async deliverToolResult(
    sessionId: string,
    callId: string,
    result: unknown,
    error?: string,
  ): Promise<void> {
    const r = await this.config.fetch(
      `${this.config.baseUrl}/sessions/${sessionId}/tool`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId, result, error }),
      },
    );
    if (!r.ok) throw new Error(`deliverToolResult failed: ${r.status}`);
  }

  /** Cancel an in-flight session (Stop button). */
  async cancelSession(sessionId: string): Promise<void> {
    try {
      await this.config.fetch(
        `${this.config.baseUrl}/sessions/${sessionId}/cancel`,
        { method: "POST" },
      );
    } catch {
      // best-effort
    }
  }

  /**
   * Load full server-side thread state.
   *
   * Returns the canonical `ThreadHistoryResponse` containing every
   * `TurnRecord` (one per turn in the thread). Each `TurnRecord` carries
   * the complete agent state needed to rehydrate both `useChat`
   * (messages) and `useAgentState` (phase / plan / sources / steps)
   * WITHOUT requiring an event replay.
   */
  async getThread(threadId: string): Promise<ThreadHistoryResponse> {
    const r = await this.config.fetch(
      `${this.config.baseUrl}/perplexity/thread/${encodeURIComponent(threadId)}`,
    );
    if (!r.ok) throw new Error(`getThread failed: ${r.status}`);
    const json = (await r.json()) as {
      thread_id: string;
      session_ids: string[];
      turns: ThreadHistoryResponse["turns"];
    };
    return {
      threadId: json.thread_id,
      sessionIds: json.session_ids,
      turns: json.turns,
    };
  }

  /**
   * Subscribe to events for a session. Returns a Subscription handle.
   *
   * Handles reconnection with Last-Event-ID automatically — if the
   * connection drops, we reconnect with `?since=<last id>` and the
   * server replays any missed events. Events are mapped from wire
   * format to the discriminated union via `fromWire`.
   */
  subscribe<T = unknown>(
    sessionId: string,
    onEvent: (e: import("./schema").AnyAnvilEvent & { _payload?: T }) => void,
  ): Subscription {
    const base = `${this.config.baseUrl}/sessions/${sessionId}/events`;
    let es: EventSource | null = null;
    let closed = false;
    let lastId = 0;
    let count = 0;
    let state: "connecting" | "open" | "closed" = "connecting";
    let retryMs = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handle = (e: MessageEvent) => {
      try {
        if ((e as unknown as { type: string }).type === "ready") {
          state = "open";
          return;
        }
        const raw = JSON.parse(e.data) as AnvilEventWire;
        if (e.lastEventId) {
          raw.event_id = Number(e.lastEventId);
        }
        if (typeof raw.event_id === "number" && !Number.isNaN(raw.event_id)) {
          lastId = raw.event_id;
        }
        const event = fromWire(raw);
        count++;
        if (event.type === "anvil.dropped") {
          this.config.onServerDrop(event as never);
        } else if (event.type === "subscriber.dropped") {
          this.config.onSubscriberDrop(event as never);
        }
        // Allow the consumer to read a loosely-typed payload via the
        // generic parameter, but still keep our discriminated union.
        onEvent(event as never);
      } catch (err) {
        console.error("anvil: malformed event", e.data, err);
      }
    };

    const connect = (since = lastId) => {
      if (closed) return;
      state = "connecting";
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      const u = since > 0 ? `${base}?since=${since}` : base;
      const newEs = new this.config.EventSource!(u);
      es = newEs;

      newEs.onopen = () => {
        state = "open";
        retryMs = 1000; // reset backoff
      };
      newEs.onerror = () => {
        if (closed) return;
        state = "connecting";
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const wait = retryMs;
        retryMs = Math.min(retryMs * 2, 8000);
        reconnectTimer = setTimeout(() => connect(lastId), wait);
      };

      for (const t of EVENT_TYPES) {
        newEs.addEventListener(t, handle as EventListener);
      }
      newEs.onmessage = handle as unknown as (this: EventSource, ev: MessageEvent) => void;
    };

    connect();

    return {
      unsubscribe: () => {
        closed = true;
        state = "closed";
        if (reconnectTimer) clearTimeout(reconnectTimer);
        es?.close();
      },
      count: () => count,
      lastEventId: () => lastId,
      state: () => state,
    };
  }
}

// Re-export type for convenience.
export type { FrontendToolCall };