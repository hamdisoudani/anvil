"use client";

/**
 * AgentUI — A zero-config, fully working agent UI.
 *
 * Just pass the return value of useAgent() and it renders the
 * entire chat interface: messages, thinking state, sources,
 * streaming text, input box, action buttons.
 *
 * Example:
 * ```tsx
 * function App() {
 *   const agent = useAgent({ url: "/api/agent" });
 *   return <AgentUI agent={agent} />;
 * }
 * ```
 *
 * Fully customizable via slots/children (coming soon).
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
import { cn as classx } from "../lib/utils";
import {
  ArrowUp,
  Sparkles,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  Check,
  Bot,
  User,
  Globe,
} from "lucide-react";
import type { UseAgentReturn, AgentState } from "@anvil/react-headless";

// ── Helpers ──────────────────────────────────────────────────────

function getActivityText(state: AgentState): string {
  const lastStep = state.planSteps[state.currentStepIndex];
  if (lastStep?.status === "running") {
    return lastStep.intent + (lastStep.detail ? `: ${lastStep.detail}` : "");
  }
  if (state.isStreaming) return "Writing answer…";
  if (state.phase === "done") return "Done";
  if (state.phase === "error") return state.error ?? "Error";
  if (state.phase === "idle") return "";
  return state.phase;
}

interface AgentUIProps {
  agent: UseAgentReturn;
  className?: string;
  placeholder?: string;
  renderTool?: Record<string, (data: any) => React.ReactNode>;
}

export function AgentUI({ agent, className, placeholder = "Ask anything…", renderTool = {} }: AgentUIProps) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-focus when idle
  React.useEffect(() => {
    if (!agent.isProcessing) {
      inputRef.current?.focus();
    }
  }, [agent.isProcessing]);

  // For each user message, show a reasoning block before the AI response
  const showReasoning = (msgIdx: number) => {
    const m = agent.messages[msgIdx];
    if (!m || m.role !== "assistant") return false;
    if (msgIdx < 1) return false;
    return agent.messages[msgIdx - 1]?.role === "user";
  };

  return (
    <div className={cn("flex h-full flex-col bg-background text-foreground", className)}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8">
          {/* Empty state */}
          {agent.messages.length === 0 && !agent.isProcessing && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <Bot className="h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg sm:text-xl font-semibold">Agent ready</h2>
              <p className="text-sm text-muted-foreground max-w-md">Type a message to start</p>
            </div>
          )}

          {/* Messages */}
          {agent.messages.map((msg, i) => (
            <React.Fragment key={msg.id}>
              {/* Reasoning between user and assistant */}
              {showReasoning(i) && (
                <Reasoning isStreaming={agent.isProcessing} defaultOpen={agent.isProcessing}>
                  <ReasoningTrigger title={`Reasoning (${agent.state.planSteps.length} step${agent.state.planSteps.length === 1 ? "" : "s"})`} />
                  <ReasoningContent>
                    <ol className="space-y-1.5 list-decimal pl-4">
                      {agent.state.planSteps
                        .filter(s => s.status === "done")
                        .map((s, si) => (
                          <li key={si} className="text-[11px] sm:text-xs">
                            <span className="font-medium">{s.intent}</span>
                            {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
                          </li>
                        ))}
                    </ol>
                  </ReasoningContent>
                </Reasoning>
              )}

              {/* User message */}
              {msg.role === "user" && (
                <Message from="user">
                  <MessageAvatar name="You" />
                  <MessageContent>{msg.content}</MessageContent>
                </Message>
              )}

              {/* Tool message — rendered via renderTool if registered */}
              {msg.role === "tool" && (msg as any).toolName && renderTool[(msg as any).toolName] && (
                <Message from="assistant">
                  <MessageAvatar name="AI" />
                  <MessageContent>
                    {renderTool[(msg as any).toolName]!(msg)}
                  </MessageContent>
                </Message>
              )}

              {/* Assistant message */}
              {msg.role === "assistant" && (
                <Message from="assistant">
                  <MessageAvatar name="AI" />
                  <MessageContent variant="flat">
                    {msg.content && (
                      <div className="mt-1">
                        <Response>{msg.content}</Response>
                        {agent.isProcessing && (
                          <span className="inline-block w-1.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-text-bottom" />
                        )}
                      </div>
                    )}
                    {!msg.content && agent.isProcessing && (
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Loader size={14} />
                        <span>Thinking…</span>
                      </div>
                    )}

                    {/* Sources — only on last assistant message when done */}
                    {(msg as any).sources && (msg as any).sources.length > 0 && !agent.isProcessing && (
                      <Sources autoOpen count={(msg as any).sources.length}>
                        <SourcesTrigger count={(msg as any).sources.length} />
                        <SourcesContent>
                          {(msg as any).sources.map((s: any) => (
                            <Source key={s.id} href={s.url} title={s.title} domain={s.domain} />
                          ))}
                        </SourcesContent>
                      </Sources>
                    )}

                    {/* Related questions */}
                    {(msg as any).related && (msg as any).related.length > 0 && !agent.isProcessing && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(msg as any).related.map((q: string, qi: number) => (
                          <button key={qi} type="button"
                            className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px] sm:text-xs hover:border-foreground/30 hover:bg-accent/30 transition-colors"
                            onClick={() => agent.send(q)}>
                            <Sparkles className="h-2.5 w-2.5 text-muted-foreground" />
                            {q}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    {i === agent.messages.length - 1 && !agent.isProcessing && msg.content && (
                      <Actions>
                        <CopyButton text={msg.content} />
                        <Action tooltip="Good answer" label="Good answer" icon={ThumbsUp} onClick={() => {}} />
                        <Action tooltip="Bad answer" label="Bad answer" icon={ThumbsDown} onClick={() => {}} />
                        <Action tooltip="Regenerate" label="Regenerate" icon={RotateCw} onClick={() => {}} />
                      </Actions>
                    )}
                  </MessageContent>
                </Message>
              )}
            </React.Fragment>
          ))}

          {/* Thinking state when no assistant message yet */}
          {agent.isProcessing && agent.messages.filter(m => m.role === "assistant").length === 0 && (
            <Message from="assistant">
              <MessageAvatar name="AI" />
              <MessageContent variant="flat">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader size={14} />
                  <span>{getActivityText(agent.state) || "Thinking…"}</span>
                </div>
              </MessageContent>
            </Message>
          )}

          {/* Error */}
          {agent.error && (
            <div className="mt-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{agent.error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t bg-background shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}>
        <div className="p-2 sm:p-4">
          <form
            onSubmit={(e) => { e.preventDefault(); if (input.trim()) { agent.send(input); setInput(""); } }}
            className="mx-auto max-w-2xl lg:max-w-3xl"
          >
            <Card className="rounded-xl sm:rounded-2xl shadow-sm border">
              <div className="flex items-end gap-1.5 sm:gap-2 p-2 sm:p-3">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={placeholder}
                  rows={1}
                  disabled={agent.isProcessing}
                  enterKeyHint="send"
                  className="flex-1 min-h-[22px] sm:min-h-[24px] max-h-36 sm:max-h-48 resize-none border-0 shadow-none focus:outline-none bg-transparent px-1 text-sm leading-5 sm:leading-6 py-[3px]"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.trim()) { agent.send(input); setInput(""); } }}} />
                <Button type="submit" size="icon"
                  disabled={!input.trim() || agent.isProcessing}
                  className="h-8 w-8 sm:h-9 sm:w-9 rounded-full shrink-0 active:scale-95 transition-transform">
                  <ArrowUp className="h-4 sm:h-[18px] w-4 sm:w-[18px]" />
                </Button>
              </div>
            </Card>
            <p className="mt-1.5 text-center text-[9px] sm:text-[10px] text-muted-foreground">
              Anvil agent — verify important info
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
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}
