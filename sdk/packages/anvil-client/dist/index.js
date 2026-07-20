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
export class AnvilClient {
    constructor(config) {
        this.config = {
            fetch: config.fetch ?? fetch.bind(globalThis),
            EventSource: config.EventSource ?? globalThis.EventSource,
            onServerDrop: config.onServerDrop ?? (() => { }),
            onSubscriberDrop: config.onSubscriberDrop ?? (() => { }),
            baseUrl: config.baseUrl.replace(/\/$/, ""),
        };
    }
    /** Start a new agent task. Returns the session id and stream URL. */
    async startTask(task) {
        const r = await this.config.fetch(`${this.config.baseUrl}/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task }),
        });
        if (!r.ok)
            throw new Error(`startTask failed: ${r.status} ${await r.text()}`);
        const body = (await r.json());
        return {
            sessionId: body.session_id,
            streamUrl: body.stream_url,
        };
    }
    /** Resume a paused session. */
    async resume(sessionId) {
        const r = await this.config.fetch(`${this.config.baseUrl}/sessions/${sessionId}/resume`, { method: "POST" });
        if (!r.ok)
            throw new Error(`resume failed: ${r.status} ${await r.text()}`);
        const body = (await r.json());
        return { sessionId: body.session_id, streamUrl: body.stream_url };
    }
    /** Get current session status. */
    async status(sessionId) {
        const r = await this.config.fetch(`${this.config.baseUrl}/sessions/${sessionId}/status`);
        if (!r.ok)
            throw new Error(`status failed: ${r.status}`);
        return r.json();
    }
    /**
     * Deliver a frontend tool result back to the engine.
     * Called by the browser-side executor when it finishes a FrontendTool.
     */
    async deliverToolResult(sessionId, callId, result, error) {
        const r = await this.config.fetch(`${this.config.baseUrl}/sessions/${sessionId}/tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ call_id: callId, result, error }),
        });
        if (!r.ok)
            throw new Error(`deliverToolResult failed: ${r.status}`);
    }
    /**
     * Subscribe to events for a session. Returns a Subscription handle.
     *
     * Handles reconnection with Last-Event-ID automatically — if the
     * connection drops, we reconnect with `?since=<last id>` and the
     * server replays any missed events.
     */
    subscribe(sessionId, onEvent) {
        const url = `${this.config.baseUrl}/sessions/${sessionId}/events`;
        let es = null;
        let closed = false;
        let lastId = 0;
        let count = 0;
        let state = "connecting";
        const connect = (since = lastId) => {
            if (closed)
                return;
            state = "connecting";
            const u = since > 0 ? `${url}?since=${since}` : url;
            es = new this.config.EventSource(u);
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
            const handle = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    // The id is sent as the SSE "id:" field, available as
                    // e.lastEventId on the MessageEvent.
                    if (e.lastEventId) {
                        data.id = Number(e.lastEventId);
                    }
                    lastId = data.id;
                    count++;
                    if (data.type === "anvil.dropped") {
                        this.config.onServerDrop(data);
                    }
                    else if (data.type === "subscriber.dropped") {
                        this.config.onSubscriberDrop(data);
                    }
                    onEvent(data);
                }
                catch (err) {
                    // Malformed event — log and continue
                    console.error("anvil: malformed event", e.data, err);
                }
            };
            // SSE named events arrive as separate MessageEvent types
            es.addEventListener("session.start", handle);
            es.addEventListener("session.resume", handle);
            es.addEventListener("plan.step", handle);
            es.addEventListener("answer.chunk", handle);
            es.addEventListener("frontend.call", handle);
            es.addEventListener("sources.found", handle);
            es.addEventListener("tool.call", handle);
            es.addEventListener("tool.result", handle);
            es.addEventListener("checkpoint", handle);
            es.addEventListener("subagent", handle);
            es.addEventListener("anvil.dropped", handle);
            es.addEventListener("subscriber.dropped", handle);
            es.addEventListener("error", handle);
            es.addEventListener("done", handle);
            es.addEventListener("paused", handle);
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
//# sourceMappingURL=index.js.map