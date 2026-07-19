/**
 * @anvil/react — shadcn/ui based pre-built components.
 *
 * All components use shadcn/ui primitives (Button, Card, Badge, etc.)
 * with Tailwind utility classes. No manual CSS. The cn() helper from
 * lib/utils.ts handles class merging.
 *
 * Bring your own design system by swapping the components here. The
 * hooks layer (@anvil/react-headless) stays unchanged.
 */
import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  useAnvil,
  useSession,
  useChat,
  useFrontendTool,
  type ChatMessage,
} from "@anvil/react-headless";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Textarea } from "./components/ui/input";
import { cn } from "./lib/utils";

// ── AnvilChat: full chat UI in one component ─────────────────────

export interface AnvilChatProps {
  placeholder?: string;
  className?: string;
}

export function AnvilChat({ placeholder = "Ask a question...", className }: AnvilChatProps) {
  const session = useSession();
  const { messages } = useChat(session.sessionId);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await session.start(text);
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-3">
            <h2 className="text-3xl font-bold tracking-tight">Ask anything</h2>
            <p className="text-muted-foreground max-w-md">
              The agent will search the web, read the top sources, and stream a cited answer.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} msg={m} />
        ))}
      </div>
      <form onSubmit={submit} className="border-t bg-card p-4 flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={session.status === "running"}
          className="flex-1 min-h-[40px] max-h-48 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e as any);
            }
          }}
        />
        <Button type="submit" disabled={!input.trim() || session.status === "running"}>
          {session.status === "running" ? "..." : "Send"}
        </Button>
      </form>
      {session.error && (
        <div className="bg-destructive/10 text-destructive p-3 text-xs border-t border-destructive/30">
          {session.error.message}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.role === "tool") {
    return <DefaultToolCall msg={msg} />;
  }
  if (msg.subAgentId) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Sub-agent [{msg.subAgentRole}]
          </div>
          <Card>
            <CardContent className="pt-4 text-sm">
              {msg.content}
              {msg.isStreaming && <span className="inline-block w-1.5 h-3 bg-primary ml-0.5 animate-pulse align-middle" />}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent</div>
        <Card>
          <CardContent className="pt-4 text-sm whitespace-pre-wrap">
            {msg.content}
            {msg.isStreaming && <span className="inline-block w-1.5 h-3 bg-primary ml-0.5 animate-pulse align-middle" />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DefaultToolCall({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const hasResult = msg.toolResult !== undefined || msg.toolError !== undefined;
  return (
    <div className="flex justify-start">
      <Card className="w-full max-w-[90%]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
        >
          <span className="text-base">🔧</span>
          <span className="font-medium flex-1 text-sm">{msg.toolName}</span>
          {msg.toolError ? (
            <Badge variant="destructive">error</Badge>
          ) : hasResult ? (
            <Badge variant="secondary">done</Badge>
          ) : (
            <Badge variant="outline">running</Badge>
          )}
          <span className="text-muted-foreground text-xs">{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <CardContent className="pt-0 space-y-3 text-xs">
            <div>
              <div className="text-muted-foreground font-semibold uppercase tracking-wide mb-1">Input</div>
              <pre className="bg-muted p-2 rounded font-mono overflow-x-auto max-h-48">
                {JSON.stringify(msg.toolInput, null, 2)}
              </pre>
            </div>
            {hasResult && (
              <div>
                <div className="text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                  {msg.toolError ? "Error" : "Result"}
                </div>
                <pre className="bg-muted p-2 rounded font-mono overflow-x-auto max-h-48">
                  {msg.toolError ?? JSON.stringify(msg.toolResult, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── ChartTool example: a frontend tool that renders a chart ─────

export interface ChartToolProps {
  renderChart: (data: { type: string; values: number[]; labels?: string[] }) => React.ReactNode;
}

export function ChartTool({ renderChart }: ChartToolProps) {
  useFrontendTool<{ type: string; values: number[]; labels?: string[] }, string>({
    name: "render_chart",
    description: "Render a chart in the UI. Returns the chart's DOM id.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        values: { type: "array", items: { type: "number" } },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["type", "values"],
    },
    execute: (input) => {
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
