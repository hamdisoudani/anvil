"use client";

/**
 * ChatUI — Zero-config, production-grade responsive chat shell for Anvil.
 *
 * Mobile-first: safe-area insets, ≥44px touch targets, sticky input,
 * single-column layout. Desktop: centered max-w-2xl/3xl conversation.
 *
 * Usage:
 *   const agent = useAgent({ url: "/api" });
 *   return <ChatUI agent={agent} onNewThread={() => agent.reset()} />;
 */
import * as React from "react";
import { cn } from "../lib/utils";
import type { UseAgentReturn, ChatMessage } from "@anvil/react-headless";
import {
  Message,
  MessageContent,
  MessageAvatar,
} from "./ai-elements/message";
import {
  Conversation,
  ConversationContent,
} from "./ai-elements/conversation";
import { Response } from "./ai-elements/response";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "./ai-elements/sources";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "./ai-elements/reasoning";
import { Loader } from "./ai-elements/loader";
import { Actions, Action } from "./ai-elements/actions";
import { ErrorBanner } from "./ai-elements/error-banner";
import { AgentThinking } from "./agent-thinking";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Textarea } from "./ui/input";
import {
  ArrowUp,
  Square,
  Plus,
  Copy,
  Check,
  RotateCw,
  Sparkles,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

export interface ChatUIProps {
  /** Return value of useAgent() — preferred path. */
  agent: UseAgentReturn;
  className?: string;
  placeholder?: string;
  title?: string;
  /** Called when user taps New chat. Defaults to agent.reset(). */
  onNewThread?: () => void;
  /** Optional header slot (right side of top bar). */
  headerRight?: React.ReactNode;
  /** Empty-state title */
  emptyTitle?: string;
  /** Empty-state description */
  emptyDescription?: string;
}

// ── Hooks ────────────────────────────────────────────────────────

function useAutoResizeTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx = 160,
) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, [ref, value, maxPx]);
}

// ── Component ────────────────────────────────────────────────────

export function ChatUI({
  agent,
  className,
  placeholder = "Ask anything…",
  title = "Anvil",
  onNewThread,
  headerRight,
  emptyTitle = "What do you want to know?",
  emptyDescription =
    "Ask a question — I'll search, read sources, and answer with citations.",
}: ChatUIProps) {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  useAutoResizeTextarea(inputRef, input);

  const busy = agent.isProcessing || sending;

  React.useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const sendInThread = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || agent.isProcessing || sending) return;
      setSending(true);
      try {
        await agent.send(
          trimmed,
          agent.threadId ? { threadId: agent.threadId } : undefined,
        );
      } finally {
        setSending(false);
      }
    },
    [agent, sending],
  );

  const submit = React.useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendInThread(text);
  }, [input, busy, sendInThread]);

  const handleNew = React.useCallback(() => {
    if (onNewThread) onNewThread();
    else agent.reset();
    setInput("");
    inputRef.current?.focus();
  }, [onNewThread, agent]);

  const retryLast = React.useCallback(() => {
    const lastUser = [...agent.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUser?.content) void sendInThread(lastUser.content);
  }, [agent.messages, sendInThread]);

  const showEmpty = agent.messages.length === 0 && !busy;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col text-foreground",
        className,
      )}
      style={{ background: "var(--anvil-bg, transparent)" }}
    >
      {/* Header */}
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b px-3 sm:h-14 sm:px-4"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold">{title}</span>
            {agent.threadId && (
              <span className="block truncate text-[10px] text-muted-foreground">
                thread {agent.threadId.slice(0, 8)}…
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {headerRight}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 min-w-10 px-3 text-xs sm:h-9"
            onClick={handleNew}
          >
            <Plus className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Conversation className="h-full" style={{ background: "var(--anvil-bg)" }}>
          <ConversationContent>
            {showEmpty && (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center sm:py-24">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
                  {emptyTitle}
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {emptyDescription}
                </p>
              </div>
            )}

            {agent.messages.map((msg, i) => (
              <ChatMessageRow
                key={msg.id}
                msg={msg}
                isLast={i === agent.messages.length - 1}
                isProcessing={busy}
                agent={agent}
                showThinking={
                  msg.role === "assistant" &&
                  i > 0 &&
                  agent.messages[i - 1]?.role === "user"
                }
                copiedId={copiedId}
                onCopy={(id, content) => {
                  void navigator.clipboard.writeText(content);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 1500);
                }}
                onRetry={retryLast}
              />
            ))}

            {busy &&
              agent.messages.filter((m) => m.role === "assistant").length ===
                0 && (
                <Message from="assistant">
                  <MessageAvatar name="AI" />
                  <MessageContent variant="flat">
                    <div className="space-y-2">
                      <AgentThinking
                        events={agent.events}
                        defaultExpanded
                        compact
                      />
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader size={14} />
                        <span>Working…</span>
                      </div>
                    </div>
                  </MessageContent>
                </Message>
              )}

            {agent.error && (
              <div className="mt-3">
                <ErrorBanner
                  error={{
                    message: agent.error,
                    severity: "error",
                    retryable: true,
                  }}
                  onRetry={retryLast}
                />
              </div>
            )}
          </ConversationContent>
        </Conversation>
      </div>

      {/* Input */}
      <div
        className="shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}
      >
        <div className="p-2 sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="mx-auto max-w-2xl lg:max-w-3xl"
          >
            <Card className="rounded-2xl border shadow-sm">
              <div className="flex items-end gap-2 p-2 sm:p-3">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={placeholder}
                  rows={1}
                  disabled={busy}
                  enterKeyHint="send"
                  className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-base leading-6 shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                <Button
                  type={busy ? "button" : "submit"}
                  size="icon"
                  variant={busy ? "destructive" : "default"}
                  disabled={!busy && !input.trim()}
                  onClick={busy ? () => agent.cancel() : undefined}
                  className="h-11 w-11 shrink-0 rounded-full transition-transform active:scale-95 sm:h-10 sm:w-10"
                  aria-label={busy ? "Stop" : "Send"}
                >
                  {busy ? (
                    <Square className="h-4 w-4 fill-current" />
                  ) : (
                    <ArrowUp className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </Card>
            <p className="mt-2 px-2 text-center text-[10px] text-muted-foreground">
              Anvil can make mistakes. Verify important info.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Message row ──────────────────────────────────────────────────

function ChatMessageRow({
  msg,
  isLast,
  isProcessing,
  agent,
  showThinking,
  copiedId,
  onCopy,
  onRetry,
}: {
  msg: ChatMessage;
  isLast: boolean;
  isProcessing: boolean;
  agent: UseAgentReturn;
  showThinking: boolean;
  copiedId: string | null;
  onCopy: (id: string, content: string) => void;
  onRetry: () => void;
}) {
  if (msg.role === "user") {
    return (
      <Message from="user">
        <MessageAvatar name="You" />
        <MessageContent>{msg.content}</MessageContent>
      </Message>
    );
  }
  if (msg.role === "tool") {
    // Render tool calls with input and result
    const isFrontend = msg.toolName && msg.toolName === "change_background_color";
    return (
      <Message from="assistant">
        <MessageAvatar name="Tool" />
        <MessageContent variant="flat">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono px-2 py-0.5 rounded bg-muted">
                {msg.toolName || "tool"}
              </span>
              <span className="opacity-60">→</span>
              <span className="font-mono text-xs">{JSON.stringify(msg.toolInput).slice(0, 100)}</span>
            </div>
            {msg.toolResult && (
              <div className="text-xs text-green-600 dark:text-green-400 font-mono">
                Result: {JSON.stringify(msg.toolResult as any).slice(0, 200)}
              </div>
            )}
            {msg.toolError && (
              <div className="text-xs text-red-600 dark:text-red-400 font-mono">
                Error: {String(msg.toolError).slice(0, 200)}
              </div>
            )}
          </div>
        </MessageContent>
      </Message>
    );
  }

  const sources = msg.sources;
  const streaming = isLast && isProcessing;

  return (
    <Message from="assistant">
      <MessageAvatar name="AI" />
      <MessageContent variant="flat">
        {showThinking && (
          <div className="mb-2">
            {isLast &&
            (agent.state.phase !== "idle" ||
              agent.state.planSteps.length > 0 ||
              isProcessing) ? (
              <AgentThinking
                events={agent.events}
                defaultExpanded={streaming}
                compact
              />
            ) : (
              agent.state.planSteps.length > 0 && (
                <Reasoning isStreaming={false} defaultOpen={false}>
                  <ReasoningTrigger
                    title={`Plan (${agent.state.planSteps.length} steps)`}
                  />
                  <ReasoningContent>
                    <AgentThinking
                      events={agent.events}
                      defaultExpanded
                      compact
                    />
                  </ReasoningContent>
                </Reasoning>
              )
            )}
          </div>
        )}

        {msg.content && (
          <div className="mt-1">
            <Response>{msg.content}</Response>
            {streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-text-bottom" />
            )}
          </div>
        )}

        {!msg.content && streaming && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader size={14} />
            <span>Thinking…</span>
          </div>
        )}

        {sources && sources.length > 0 && !streaming && (
          <div className="mt-3">
            <Sources autoOpen={isLast} count={sources.length}>
              <SourcesTrigger count={sources.length} />
              <SourcesContent>
                {sources.map((s) => (
                  <Source
                    key={s.id}
                    href={s.url}
                    title={s.title}
                    domain={s.domain}
                  />
                ))}
              </SourcesContent>
            </Sources>
          </div>
        )}

        {msg.content && !streaming && (
          <Actions className="mt-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
            <Action
              label="Copy"
              icon={copiedId === msg.id ? Check : Copy}
              onClick={() => onCopy(msg.id, msg.content)}
            />
            {isLast && (
              <Action label="Retry" icon={RotateCw} onClick={onRetry} />
            )}
          </Actions>
        )}
      </MessageContent>
    </Message>
  );
}
