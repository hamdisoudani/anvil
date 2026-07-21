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
    async startTask(task, opts) {
        const body = { task, question: task };
        if (opts?.threadId)
            body.thread_id = opts.threadId;
        if (opts?.focus)
            body.focus = opts.focus;
        const r = await this.config.fetch(`${this.config.baseUrl}/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!r.ok)
            throw new Error(`startTask failed: ${r.status} ${await r.text()}`);
        const json = (await r.json());
        return {
            sessionId: json.session_id,
            threadId: json.thread_id ?? json.session_id,
            streamUrl: json.stream_url,
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
    /** Cancel an in-flight session (Stop button). Server cancels the search goroutine. */
    async cancelSession(sessionId) {
        try {
            await this.config.fetch(`${this.config.baseUrl}/sessions/${sessionId}/cancel`, {
                method: "POST",
            });
        }
        catch {
            // best-effort
        }
    }
    /** Load server-side thread memory (messages + session ids). */
    async getThread(threadId) {
        const r = await this.config.fetch(`${this.config.baseUrl}/perplexity/thread/${encodeURIComponent(threadId)}`);
        if (!r.ok)
            throw new Error(`getThread failed: ${r.status}`);
        return r.json();
    }
    /**
     * Subscribe to events for a session. Returns a Subscription handle.
     *
     * Handles reconnection with Last-Event-ID automatically — if the
     * connection drops, we reconnect with `?since=<last id>` and the
     * server replays any missed events.
     */
    subscribe(sessionId, onEvent) {
        // Prefer perplexity stream path; sessions shim also works.
        const base = `${this.config.baseUrl}/sessions/${sessionId}/events`;
        let es = null;
        let closed = false;
        let lastId = 0;
        let count = 0;
        let state = "connecting";
        let retryMs = 1000;
        let reconnectTimer = null;
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
        ];
        const handle = (e) => {
            try {
                // ready event is a control frame without full AnvilEvent shape
                if (e.type === "ready") {
                    state = "open";
                    return;
                }
                const data = JSON.parse(e.data);
                if (e.lastEventId) {
                    data.id = Number(e.lastEventId);
                }
                if (typeof data.id === "number" && !Number.isNaN(data.id)) {
                    lastId = data.id;
                }
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
                console.error("anvil: malformed event", e.data, err);
            }
        };
        const connect = (since = lastId) => {
            if (closed)
                return;
            state = "connecting";
            // Close previous ES so native auto-reconnect does not fight us
            try {
                es?.close();
            }
            catch {
                /* ignore */
            }
            const u = since > 0 ? `${base}?since=${since}` : base;
            es = new this.config.EventSource(u);
            es.onopen = () => {
                state = "open";
                retryMs = 1000; // reset backoff
            };
            es.onerror = () => {
                if (closed)
                    return;
                state = "connecting";
                try {
                    es?.close();
                }
                catch {
                    /* ignore */
                }
                // Custom reconnect with ?since= — native ES cannot inject query params
                if (reconnectTimer)
                    clearTimeout(reconnectTimer);
                const wait = retryMs;
                retryMs = Math.min(retryMs * 2, 8000);
                reconnectTimer = setTimeout(() => connect(lastId), wait);
            };
            for (const t of EVENT_TYPES) {
                es.addEventListener(t, handle);
            }
            // Also listen for default message events as fallback
            es.onmessage = handle;
        };
        connect();
        return {
            unsubscribe: () => {
                closed = true;
                state = "closed";
                if (reconnectTimer)
                    clearTimeout(reconnectTimer);
                es?.close();
            },
            count: () => count,
            lastEventId: () => lastId,
            state: () => state,
        };
    }
}
//# sourceMappingURL=index.js.map