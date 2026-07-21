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

// ── Component ────────────────────────────────────────────────────

export function ChatUI({
  agent,
  className,
  placeholder = "Ask anything…",
  title = "Anvil",
  onNewThread,
  headerRight,
  emptyTitle = "What do you want to know?",
  emptyDescription = "Ask a question — I'll search, read sources, and answer with citations.",
}: ChatUIProps) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!agent.isProcessing) inputRef.current?.focus();
  }, [agent.isProcessing]);

  const submit = React.useCallback(async () => {
    const text = input.trim();
    if (!text || agent.isProcessing) return;
    setInput("");
    await agent.send(text, agent.threadId ? { threadId: agent.threadId } : undefined);
  }, [input, agent]);

  const handleNew = React.useCallback(() => {
    if (onNewThread) onNewThread();
    else agent.reset();
    setInput("");
    inputRef.current?.focus();
  }, [onNewThread, agent]);

  const showEmpty = agent.messages.length === 0 && !agent.isProcessing;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-background text-foreground",
        className,
      )}
    >
      {/* Header */}
      <header
        className="flex h-12 sm:h-14 items-center justify-between border-b px-3 sm:px-4 shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {headerRight}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 min-w-10 sm:h-9 px-3 text-xs"
            onClick={handleNew}
          >
            <Plus className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Conversation className="h-full">
          <ConversationContent>
            {showEmpty && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 sm:py-24 text-center px-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
                  {emptyTitle}
                </h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  {emptyDescription}
                </p>
              </div>
            )}

            {agent.messages.map((msg, i) => (
              <ChatMessageRow
                key={msg.id}
                msg={msg}
                isLast={i === agent.messages.length - 1}
                isProcessing={agent.isProcessing}
                agent={agent}
                showThinking={
                  msg.role === "assistant" &&
                  i > 0 &&
                  agent.messages[i - 1]?.role === "user" &&
                  (i === agent.messages.length - 1 ||
                    agent.messages[i + 1]?.role === "user")
                }
                copiedId={copiedId}
                onCopy={(id, content) => {
                  void navigator.clipboard.writeText(content);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 1500);
                }}
                onRetry={() => {
                  const lastUser = [...agent.messages]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (lastUser?.content) {
                    void agent.send(
                      lastUser.content,
                      agent.threadId ? { threadId: agent.threadId } : undefined,
                    );
                  }
                }}
              />
            ))}

            {agent.isProcessing &&
              agent.messages.filter((m) => m.role === "assistant").length === 0 && (
                <Message from="assistant">
                  <MessageAvatar name="AI" />
                  <MessageContent variant="flat">
                    <div className="space-y-2">
                      <AgentThinking events={agent.events} defaultExpanded compact />
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
                  onRetry={() => {
                    const lastUser = [...agent.messages]
                      .reverse()
                      .find((m) => m.role === "user");
                    if (lastUser?.content) {
                      void agent.send(
                        lastUser.content,
                        agent.threadId ? { threadId: agent.threadId } : undefined,
                      );
                    }
                  }}
                />
              </div>
            )}
          </ConversationContent>
        </Conversation>
      </div>

      {/* Input */}
      <div
        className="border-t bg-background shrink-0"
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
            <Card className="rounded-2xl shadow-sm border">
              <div className="flex items-end gap-2 p-2 sm:p-3">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={placeholder}
                  rows={1}
                  disabled={agent.isProcessing}
                  enterKeyHint="send"
                  className="flex-1 min-h-[44px] max-h-40 resize-none border-0 shadow-none focus:outline-none bg-transparent px-2 text-base sm:text-sm leading-6 py-2.5"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!input.trim() || agent.isProcessing}
                  className="h-11 w-11 sm:h-10 sm:w-10 rounded-full shrink-0 active:scale-95 transition-transform"
                  aria-label="Send"
                >
                  <ArrowUp className="h-5 w-5" />
                </Button>
              </div>
            </Card>
            <p className="mt-2 text-center text-[10px] text-muted-foreground px-2">
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
  if (msg.role === "tool") return null;

  const sources = (msg as ChatMessage & {
    sources?: Array<{ id: number; url: string; title: string; domain: string }>;
  }).sources;
  const streaming = isLast && isProcessing;

  return (
    <Message from="assistant">
      <MessageAvatar name="AI" />
      <MessageContent variant="flat">
        {showThinking && (
          <div className="mb-2">
            {isLast && (agent.state.phase !== "idle" || agent.state.planSteps.length > 0) ? (
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
                    <AgentThinking events={agent.events} defaultExpanded compact />
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
              <span className="inline-block w-1.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-text-bottom" />
            )}
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
