/**
 * Anvil client — framework-agnostic.
 *
 * The client speaks the Anvil wire protocol:
 *   - POST /tasks                       start a session (optionally continuing a thread_id)
 *   - GET  /sessions/:id/events         live stream (SSE)
 *   - GET  /sessions/:id/events?since=N resume from N
 *   - POST /sessions/:id/tool           deliver a frontend tool result
 *   - POST /sessions/:id/resume         resume from checkpoint
 *   - GET  /sessions/:id/status         current step, drop count
 *
 * This is the lowest layer. It knows nothing about React. It emits
 * typed events and handles reconnection. Use it directly in vanilla
 * JS, Vue, Svelte, server-side, anywhere.
 */

export type EventType =
  | "session.start"
  | "session.resume"
  | "think.start"
  | "think.chunk"
  | "think.end"
  | "tool.call"
  | "tool.result"
  | "checkpoint"
  | "subagent"
  | "anvil.dropped"
  | "subscriber.dropped"
  | "error"
  | "done"
  | "paused"
  | string; // forward-compat for new event types

export interface AnvilEvent<T = unknown> {
  /** Monotonic ID assigned by the engine. Use for Last-Event-ID resume. */
  id: number;
  type: EventType;
  sessionId: string;
  payload: T;
  createdAt: string;
}

export interface FrontendToolCall<TInput = unknown> {
  callId: string;
  name: string;
  input: TInput;
}

export interface SessionStatus {
  sessionId: string;
  step: number;
  subCount: number;
}

export interface ClientConfig {
  /** Base URL of the Anvil HTTP server. e.g. "http://localhost:8080" */
  baseUrl: string;
  /** Custom fetch impl (for SSR, tests, or auth headers). */
  fetch?: typeof fetch;
  /** Custom EventSource impl (for Node tests). */
  EventSource?: typeof EventSource;
  /** Called when a server-side drop is detected. */
  onServerDrop?: (event: AnvilEvent) => void;
  /** Called when a subscriber drop marker arrives. */
  onSubscriberDrop?: (event: AnvilEvent) => void;
}

/** Subscription handle returned by subscribe(). */
export interface Subscription {
  /** Stop receiving events. */
  unsubscribe: () => void;
  /** Number of events received so far. */
  count: () => number;
  /** Last event id seen (for resume on reconnect). */
  lastEventId: () => number;
  /** Current state: connecting | open | closed. */
  state: () => "connecting" | "open" | "closed";
}

export class AnvilClient {
  private config: Required<ClientConfig>;

  constructor(config: ClientConfig) {
    this.config = {
      fetch: config.fetch ?? fetch.bind(globalThis),
      EventSource: config.EventSource ?? (globalThis as any).EventSource,
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
   *
   * Returns the new sessionId, the threadId (echoed back; may equal the
   * provided threadId or a fresh one if none was given), and the SSE
   * stream URL for this session.
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
    if (!r.ok) throw new Error(`startTask failed: ${r.status} ${await r.text()}`);
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
  async resume(sessionId: string): Promise<{ sessionId: string; streamUrl: string }> {
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

  /** Cancel an in-flight session (Stop button). Server cancels the search goroutine. */
  async cancelSession(sessionId: string): Promise<void> {
    try {
      await this.config.fetch(`${this.config.baseUrl}/sessions/${sessionId}/cancel`, {
        method: "POST",
      });
    } catch {
      // best-effort
    }
  }

  /** Load server-side thread memory (messages + session ids). */
  async getThread(threadId: string): Promise<{
    thread_id: string;
    session_ids: string[];
    messages: Array<{ role: string; content: string }>;
  }> {
    const r = await this.config.fetch(
      `${this.config.baseUrl}/perplexity/thread/${encodeURIComponent(threadId)}`,
    );
    if (!r.ok) throw new Error(`getThread failed: ${r.status}`);
    return r.json();
  }

  /**
   * Subscribe to events for a session. Returns a Subscription handle.
   *
   * Handles reconnection with Last-Event-ID automatically — if the
   * connection drops, we reconnect with `?since=<last id>` and the
   * server replays any missed events.
   */
  subscribe<T = unknown>(
    sessionId: string,
    onEvent: (e: AnvilEvent<T>) => void,
  ): Subscription {
    // Prefer perplexity stream path; sessions shim also works.
    const base = `${this.config.baseUrl}/sessions/${sessionId}/events`;
    let es: EventSource | null = null;
    let closed = false;
    let lastId = 0;
    let count = 0;
    let state: "connecting" | "open" | "closed" = "connecting";
    let retryMs = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const EVENT_TYPES = [
      "session.start",
      "session.resume",
      "plan.step",
      "answer.chunk",
      "think.chunk",
      "frontend.call",
      "sources.found",
      "tool.call",
      "tool.result",
      "checkpoint",
      "subagent",
      "anvil.dropped",
      "subscriber.dropped",
      "error",
      "done",
      "paused",
      "ready",
    ] as const;

    const handle = (e: MessageEvent) => {
      try {
        // ready event is a control frame without full AnvilEvent shape
        if ((e as any).type === "ready") {
          state = "open";
          return;
        }
        const data = JSON.parse(e.data) as AnvilEvent<T>;
        if (e.lastEventId) {
          data.id = Number(e.lastEventId);
        }
        if (typeof data.id === "number" && !Number.isNaN(data.id)) {
          lastId = data.id;
        }
        count++;
        if (data.type === "anvil.dropped") {
          this.config.onServerDrop(data);
        } else if (data.type === "subscriber.dropped") {
          this.config.onSubscriberDrop(data);
        }
        onEvent(data);
      } catch (err) {
        console.error("anvil: malformed event", e.data, err);
      }
    };

    const connect = (since = lastId) => {
      if (closed) return;
      state = "connecting";
      // Close previous ES so native auto-reconnect does not fight us
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      const u = since > 0 ? `${base}?since=${since}` : base;
      es = new this.config.EventSource!(u);

      es.onopen = () => {
        state = "open";
        retryMs = 1000; // reset backoff
      };
      es.onerror = () => {
        if (closed) return;
        state = "connecting";
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        // Custom reconnect with ?since= — native ES cannot inject query params
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const wait = retryMs;
        retryMs = Math.min(retryMs * 2, 8000);
        reconnectTimer = setTimeout(() => connect(lastId), wait);
      };

      for (const t of EVENT_TYPES) {
        es.addEventListener(t, handle as EventListener);
      }
      // Also listen for default message events as fallback
      es.onmessage = handle as any;
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
