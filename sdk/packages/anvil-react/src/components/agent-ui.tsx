"use client";

/**
 * AgentUI — Zero-config, production chat surface for Anvil.
 *
 * Pass the return value of useAgent() and get:
 * - Thread-aware multi-turn send (reuses agent.threadId)
 * - Streaming markdown answers
 * - Live thinking / plan steps
 * - Sources + related questions
 * - HITL interrupt dialogs
 * - Mobile-safe composer (native textarea, safe-area, ≥44px targets)
 *
 * Example:
 * ```tsx
 * const agent = useAgent({ url: "/api/agent" });
 * return <AgentUI agent={agent} />;
 * ```
 */
import * as React from "react";
import { cn } from "../lib/utils";
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
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Textarea } from "./ui/input";
import { ErrorBanner } from "./ai-elements/error-banner";
import { AgentThinking } from "./agent-thinking";
import {
  ArrowUp,
  Sparkles,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  Check,
  Bot,
  Square,
} from "lucide-react";
import type {
  UseAgentReturn,
  AgentState,
  PendingInterrupt,
  ChatMessage,
} from "@anvil/react-headless";

// ── Helpers ──────────────────────────────────────────────────────

function getActivityText(state: AgentState): string {
  const lastStep = state.planSteps[state.currentStepIndex];
  if (lastStep?.status === "running") {
    return lastStep.intent + (lastStep.detail ? `: ${lastStep.detail}` : "");
  }
  if (state.isStreaming) return "Writing answer…";
  if (state.phase === "done") return "Done";
  if (state.phase === "error") return state.error?.message ?? "Error";
  if (state.phase === "idle") return "";
  return state.phase;
}

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

// ── Interrupt Dialog ─────────────────────────────────────────────

function InterruptDialog({
  interrupt,
  onApprove,
  onReject,
}: {
  interrupt: PendingInterrupt;
  onApprove: (result: any) => void;
  onReject: () => void;
}) {
  const [selected, setSelected] = React.useState(0);
  const [formData, setFormData] = React.useState<Record<string, string>>({});
  const input = interrupt.input || {};

  const isApproval =
    input.reason === "approval" || interrupt.toolName.includes("approve");
  const isChoice = input.reason === "choice" || !!input.options;
  const isInput = input.reason === "input" || !!input.schema;

  if (isApproval) {
    return (
      <Card className="mx-auto my-4 max-w-md rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-4">
        <p className="mb-1 text-sm font-medium">
          {input.title || "Approval required"}
        </p>
        <p className="mb-3 text-xs text-muted-foreground sm:text-sm">
          {input.message || interrupt.toolName}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApprove({ approved: true })}>
            Continue
          </Button>
        </div>
      </Card>
    );
  }

  if (isChoice) {
    return (
      <Card className="mx-auto my-4 max-w-md rounded-xl border p-4">
        <p className="mb-2 text-sm font-medium">
          {input.title || "Select an option"}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {(input.options || []).map((opt: string, i: number) => (
            <Button
              key={i}
              variant={selected === i ? "default" : "outline"}
              size="sm"
              onClick={() => setSelected(i)}
            >
              {opt}
            </Button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApprove({ selected })}>
            Select
          </Button>
        </div>
      </Card>
    );
  }

  if (isInput) {
    return (
      <Card className="mx-auto my-4 max-w-md rounded-xl border p-4">
        <p className="mb-2 text-sm font-medium">
          {input.title || "Input required"}
        </p>
        {input.schema?.properties &&
          Object.keys(input.schema.properties).map((key) => (
            <div key={key} className="mb-2">
              <label className="text-[11px] text-muted-foreground">{key}</label>
              <Textarea
                className="min-h-[44px] text-sm"
                placeholder={
                  input.schema.properties[key]?.description || key
                }
                value={formData[key] ?? ""}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </div>
          ))}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApprove(formData)}>
            Submit
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mx-auto my-4 max-w-md rounded-xl border p-4">
      <p className="mb-1 text-sm font-medium">Agent needs input</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Tool: {interrupt.toolName}
      </p>
      <pre className="mb-3 max-h-32 overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
        {JSON.stringify(input, null, 2)}
      </pre>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onReject}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onApprove({})}>
          Continue
        </Button>
      </div>
    </Card>
  );
}

// ── Message row ──────────────────────────────────────────────────

function MessageRow({
  msg,
  index,
  messages,
  agent,
  renderTool,
  onSend,
  onRetry,
}: {
  msg: ChatMessage;
  index: number;
  messages: ChatMessage[];
  agent: UseAgentReturn;
  renderTool: Record<string, (data: any) => React.ReactNode>;
  onSend: (text: string) => void;
  onRetry: () => void;
}) {
  const isLast = index === messages.length - 1;
  const streaming = isLast && agent.isProcessing && msg.role === "assistant";
  const showThinking =
    msg.role === "assistant" &&
    index > 0 &&
    messages[index - 1]?.role === "user";

  if (msg.role === "user") {
    return (
      <Message from="user">
        <MessageAvatar name="You" />
        <MessageContent>{msg.content}</MessageContent>
      </Message>
    );
  }

  if (msg.role === "tool") {
    if (msg.toolName && renderTool[msg.toolName]) {
      return (
        <Message from="assistant">
          <MessageAvatar name="AI" />
          <MessageContent variant="flat">
            {renderTool[msg.toolName]!(msg)}
          </MessageContent>
        </Message>
      );
    }
    return null;
  }

  // assistant
  return (
    <Message from="assistant">
      <MessageAvatar name="AI" />
      <MessageContent variant="flat">
        {showThinking && (
          <div className="mb-2">
            {isLast &&
            (agent.isProcessing || agent.state.planSteps.length > 0) ? (
              <AgentThinking
                events={agent.events}
                defaultExpanded={streaming}
                compact
              />
            ) : agent.state.planSteps.length > 0 ? (
              <Reasoning isStreaming={false} defaultOpen={false}>
                <ReasoningTrigger
                  title={`Reasoning (${agent.state.planSteps.length} step${
                    agent.state.planSteps.length === 1 ? "" : "s"
                  })`}
                />
                <ReasoningContent>
                  <ol className="list-decimal space-y-1.5 pl-4">
                    {agent.state.planSteps
                      .filter((s) => s.status === "done")
                      .map((s, si) => (
                        <li key={si} className="text-[11px] sm:text-xs">
                          <span className="font-medium">{s.intent}</span>
                          {s.detail && (
                            <span className="text-muted-foreground">
                              {" "}
                              — {s.detail}
                            </span>
                          )}
                        </li>
                      ))}
                  </ol>
                </ReasoningContent>
              </Reasoning>
            ) : null}
          </div>
        )}

        {msg.content ? (
          <div className="mt-1">
            <Response>{msg.content}</Response>
            {streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-text-bottom" />
            )}
          </div>
        ) : streaming ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader size={14} />
            <span>{getActivityText(agent.state) || "Thinking…"}</span>
          </div>
        ) : null}

        {msg.sources && msg.sources.length > 0 && !streaming && (
          <div className="mt-3">
            <Sources autoOpen={isLast} count={msg.sources.length}>
              <SourcesTrigger count={msg.sources.length} />
              <SourcesContent>
                {msg.sources.map((s) => (
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

        {msg.related && msg.related.length > 0 && !streaming && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {msg.related.map((q, qi) => (
              <button
                key={qi}
                type="button"
                className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px] transition-colors hover:border-foreground/30 hover:bg-accent/30 sm:text-xs"
                onClick={() => onSend(q)}
              >
                <Sparkles className="h-2.5 w-2.5 text-muted-foreground" />
                {q}
              </button>
            ))}
          </div>
        )}

        {isLast && !streaming && msg.content && (
          <Actions className="mt-2">
            <CopyButton text={msg.content} />
            <Action
              tooltip="Good answer"
              label="Good answer"
              icon={ThumbsUp}
              onClick={() => {}}
            />
            <Action
              tooltip="Bad answer"
              label="Bad answer"
              icon={ThumbsDown}
              onClick={() => {}}
            />
            <Action
              tooltip="Regenerate"
              label="Regenerate"
              icon={RotateCw}
              onClick={onRetry}
            />
          </Actions>
        )}
      </MessageContent>
    </Message>
  );
}

// ── Main Component ───────────────────────────────────────────────

interface AgentUIProps {
  agent: UseAgentReturn;
  className?: string;
  placeholder?: string;
  renderTool?: Record<string, (data: any) => React.ReactNode>;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function AgentUI({
  agent,
  className,
  placeholder = "Ask anything…",
  renderTool = {},
  emptyTitle = "Agent ready",
  emptyDescription = "Type a message to start a thread",
}: AgentUIProps) {
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  useAutoResizeTextarea(inputRef, input);

  React.useEffect(() => {
    if (!agent.isProcessing && !sending) {
      inputRef.current?.focus();
    }
  }, [agent.isProcessing, sending]);

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
    if (!text || agent.isProcessing || sending) return;
    setInput("");
    await sendInThread(text);
  }, [input, agent.isProcessing, sending, sendInThread]);

  const retryLast = React.useCallback(() => {
    const lastUser = [...agent.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUser?.content) void sendInThread(lastUser.content);
  }, [agent.messages, sendInThread]);

  const busy = agent.isProcessing || sending;
  const showEmpty = agent.messages.length === 0 && !busy;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-background text-foreground",
        className,
      )}
    >
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Conversation className="h-full">
          <ConversationContent>
            {showEmpty && (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center sm:py-24">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Bot className="h-5 w-5 text-muted-foreground" />
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
              <MessageRow
                key={msg.id}
                msg={msg}
                index={i}
                messages={agent.messages}
                agent={agent}
                renderTool={renderTool}
                onSend={(t) => void sendInThread(t)}
                onRetry={retryLast}
              />
            ))}

            {agent.pendingInterrupt && (
              <InterruptDialog
                interrupt={agent.pendingInterrupt}
                onApprove={agent.approveInterrupt}
                onReject={() => agent.rejectInterrupt()}
              />
            )}

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
                        <span>
                          {getActivityText(agent.state) || "Thinking…"}
                        </span>
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

      {/* Composer */}
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
              {agent.threadId
                ? `Thread ${agent.threadId.slice(0, 8)}… · Anvil can make mistakes`
                : "Anvil can make mistakes. Verify important info."}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Action
      tooltip={copied ? "Copied" : "Copy"}
      label="Copy"
      icon={copied ? Check : Copy}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}
