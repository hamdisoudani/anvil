/**
 * @anvil/react — pre-built components.
 *
 * Drop-in UI for the most common Anvil use cases. Bring your own
 * design system on top, or use these as-is.
 */

import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  useAnvil,
  useSession,
  useChat,
  useFrontendTool,
  type ChatMessage,
} from "@anvil/react-headless";

// ── AnvilChat: full chat UI in one component ─────────────────────

export interface AnvilChatProps {
  /** Placeholder for the input box. */
  placeholder?: string;
  /** Custom render for tool calls. */
  renderToolCall?: (msg: ChatMessage) => React.ReactNode;
  /** Custom render for sub-agent messages. */
  renderSubAgent?: (msg: ChatMessage) => React.ReactNode;
  /** Auto-focus the input on mount. */
  autoFocus?: boolean;
  /** Custom className for the container. */
  className?: string;
}

export function AnvilChat(props: AnvilChatProps) {
  const {
    placeholder = "Ask the agent anything…",
    renderToolCall,
    renderSubAgent,
    autoFocus = true,
    className,
  } = props;
  const session = useSession();
  const { messages } = useChat(session.sessionId);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await session.start(text);
  };

  return (
    <div className={className ?? "anvil-chat"}>
      <div className="anvil-chat__messages" data-testid="anvil-messages">
        {messages.length === 0 && (
          <div className="anvil-chat__empty">
            {session.status === "running" ? "Thinking…" : placeholder}
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} msg={m}
            renderToolCall={renderToolCall}
            renderSubAgent={renderSubAgent}
          />
        ))}
      </div>
      <form onSubmit={submit} className="anvil-chat__form">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={session.status === "running"}
          className="anvil-chat__input"
        />
        <button
          type="submit"
          disabled={!input.trim() || session.status === "running"}
          className="anvil-chat__send"
        >
          {session.status === "running" ? "…" : "Send"}
        </button>
      </form>
      {session.error && (
        <div className="anvil-chat__error">{session.error.message}</div>
      )}
    </div>
  );
}

function ChatBubble(props: {
  msg: ChatMessage;
  renderToolCall?: (m: ChatMessage) => React.ReactNode;
  renderSubAgent?: (m: ChatMessage) => React.ReactNode;
}) {
  const { msg, renderToolCall, renderSubAgent } = props;
  if (msg.role === "user") {
    return (
      <div className="anvil-bubble anvil-bubble--user">
        <div className="anvil-bubble__role">You</div>
        <div className="anvil-bubble__content">{msg.content}</div>
      </div>
    );
  }
  if (msg.role === "tool") {
    if (renderToolCall) return <>{renderToolCall(msg)}</>;
    return <DefaultToolCall msg={msg} />;
  }
  // assistant
  if (msg.subAgentId) {
    if (renderSubAgent) return <>{renderSubAgent(msg)}</>;
    return (
      <div className="anvil-bubble anvil-bubble--subagent">
        <div className="anvil-bubble__role">
          <span className="anvil-bubble__role-icon">🔀</span>
          Sub-agent [{msg.subAgentRole}]
        </div>
        <div className="anvil-bubble__content">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="anvil-bubble anvil-bubble--assistant">
      <div className="anvil-bubble__role">Agent</div>
      <div className="anvil-bubble__content">
        {msg.content}
        {msg.isStreaming && <span className="anvil-bubble__cursor">▍</span>}
      </div>
    </div>
  );
}

function DefaultToolCall({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const hasResult = msg.toolResult !== undefined || msg.toolError !== undefined;
  return (
    <div className="anvil-tool">
      <button
        className="anvil-tool__header"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span className="anvil-tool__icon">🔧</span>
        <span className="anvil-tool__name">{msg.toolName}</span>
        {msg.toolError ? (
          <span className="anvil-tool__status anvil-tool__status--error">error</span>
        ) : hasResult ? (
          <span className="anvil-tool__status anvil-tool__status--done">done</span>
        ) : (
          <span className="anvil-tool__status anvil-tool__status--running">…</span>
        )}
        <span className="anvil-tool__chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="anvil-tool__body">
          <div className="anvil-tool__section">
            <div className="anvil-tool__label">Input</div>
            <pre className="anvil-tool__code">
              {JSON.stringify(msg.toolInput, null, 2)}
            </pre>
          </div>
          {hasResult && (
            <div className="anvil-tool__section">
              <div className="anvil-tool__label">
                {msg.toolError ? "Error" : "Result"}
              </div>
              <pre className="anvil-tool__code">
                {msg.toolError ?? JSON.stringify(msg.toolResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AnvilEventLog: raw event stream viewer (debugging) ──────────

import { useEvents } from "@anvil/react-headless";

export function AnvilEventLog({ sessionId }: { sessionId: string | null }) {
  const { events } = useEvents(sessionId);
  return (
    <div className="anvil-eventlog">
      {events.map((e) => (
        <div key={e.id} className="anvil-eventlog__row">
          <span className="anvil-eventlog__id">#{e.id}</span>
          <span className="anvil-eventlog__type">{e.type}</span>
          <span className="anvil-eventlog__payload">
            {JSON.stringify(e.payload)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── ChartTool example: a frontend tool that renders a chart ─────

export interface ChartToolProps {
  /** Function to actually render the chart. Called with the data. */
  renderChart: (data: { type: string; values: number[]; labels?: string[] }) => React.ReactNode;
}

/** Declares a `render_chart` frontend tool. Mount once per app. */
export function ChartTool({ renderChart }: ChartToolProps) {
  useFrontendTool<{ type: string; values: number[]; labels?: string[] }, string>({
    name: "render_chart",
    description:
      "Render a chart in the UI. Use this whenever the user asks for a chart, graph, or visual breakdown of data. Returns the chart's DOM id.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "bar, line, or pie" },
        values: { type: "array", items: { type: "number" } },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["type", "values"],
    },
    execute: (input) => {
      // The actual rendering happens in the parent — we just need to
      // emit a result back. The render function is invoked by the
      // parent of ChartTool.
      renderChart(input);
      return `chart-rendered-${Date.now()}`;
    },
  });
  return null;
}

// Re-exports for convenience
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool } from "@anvil/react-headless";
export type { ChatMessage } from "@anvil/react-headless";
export type { AnvilEvent } from "@anvil/client";
