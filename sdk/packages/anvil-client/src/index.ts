/**
 * Anvil client — framework-agnostic.
 *
 * The client speaks the Anvil wire protocol:
 *   - POST /tasks                       start a session
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

  /** Start a new agent task. Returns the session id and stream URL. */
  async startTask(task: string): Promise<{ sessionId: string; streamUrl: string }> {
    const r = await this.config.fetch(`${this.config.baseUrl}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    });
    if (!r.ok) throw new Error(`startTask failed: ${r.status} ${await r.text()}`);
    const body = (await r.json()) as { session_id: string; stream_url: string };
    return {
      sessionId: body.session_id,
      streamUrl: body.stream_url,
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
    const url = `${this.config.baseUrl}/sessions/${sessionId}/events`;
    let es: EventSource | null = null;
    let closed = false;
    let lastId = 0;
    let count = 0;
    let state: "connecting" | "open" | "closed" = "connecting";

    const connect = (since = lastId) => {
      if (closed) return;
      state = "connecting";
      const u = since > 0 ? `${url}?since=${since}` : url;
      es = new this.config.EventSource!(u);

      es.onopen = () => {
        state = "open";
      };
      es.onerror = () => {
        // EventSource will auto-reconnect; we just need to track
        // that the connection went down. The next event we get
        // will have the correct id, so onclose isn't needed.
        state = "connecting";
      };
      // The 'message' event is the default — we use named events
      // for typed handlers. SSE sends each event as a separate
      // message with the event type as the discriminator.
      const handle = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as AnvilEvent<T>;
          // The id is sent as the SSE "id:" field, available as
          // e.lastEventId on the MessageEvent.
          if (e.lastEventId) {
            data.id = Number(e.lastEventId);
          }
          lastId = data.id;
          count++;
          if (data.type === "anvil.dropped") {
            this.config.onServerDrop(data);
          } else if (data.type === "subscriber.dropped") {
            this.config.onSubscriberDrop(data);
          }
          onEvent(data);
        } catch (err) {
          // Malformed event — log and continue
          console.error("anvil: malformed event", e.data, err);
        }
      };
      // SSE named events arrive as separate MessageEvent types
      es.addEventListener("session.start", handle as any);
      es.addEventListener("session.resume", handle as any);
      es.addEventListener("think.start", handle as any);
      es.addEventListener("think.chunk", handle as any);
      es.addEventListener("think.end", handle as any);
      es.addEventListener("tool.call", handle as any);
      es.addEventListener("tool.result", handle as any);
      es.addEventListener("checkpoint", handle as any);
      es.addEventListener("subagent", handle as any);
      es.addEventListener("anvil.dropped", handle as any);
      es.addEventListener("subscriber.dropped", handle as any);
      es.addEventListener("error", handle as any);
      es.addEventListener("done", handle as any);
      es.addEventListener("paused", handle as any);
    };

    connect();

    return {
      unsubscribe: () => {
        closed = true;
        state = "closed";
        es?.close();
      },
      count: () => count,
      lastEventId: () => lastId,
      state: () => state,
    };
  }
}
