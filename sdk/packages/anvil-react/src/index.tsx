/**
 * AnvilPerplexity — v2.0
 *
 * Built on AI Elements (Message, Conversation, Response, Sources,
 * Reasoning, Loader, Actions).
 *
 * Behavior:
 * - Sources appear AFTER agent finishes streaming (collapsible,
 *   auto-opens on completion, auto-collapses on new thread).
 * - Reasoning is a collapsible step-by-step trace of what the agent
 *   did (planning, searching, reading, writing).
 * - Streaming answer text is rendered as Markdown.
 * - URL hash routing: /#/thread/<id> for reloadable threads.
 * - Thread history saved to localStorage.
 */
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import {
  useAnvil,
  useSession,
  useChat,
  useFrontendTool,
  useAgentState,
  type AnvilEvent,
  type ChatMessage,
} from "@anvil/react-headless";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Textarea } from "./components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import {
  Message,
  MessageContent,
  MessageAvatar,
} from "./components/ai-elements/message";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "./components/ai-elements/conversation";
import { Response } from "./components/ai-elements/response";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "./components/ai-elements/sources";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "./components/ai-elements/reasoning";
import { Loader } from "./components/ai-elements/loader";
import { Actions, Action } from "./components/ai-elements/actions";
import { cn } from "./lib/utils";
import {
  Search,
  ArrowUp,
  Sparkles,
  Globe,
  GraduationCap,
  Newspaper,
  MessageCircle,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  Plus,
  History,
  X,
  Trash2,
  Check,
} from "lucide-react";

// ── Config ───────────────────────────────────────────────────────

const FOCUS_MODES = [
  { id: "web", label: "Web", icon: Globe },
  { id: "academic", label: "Academic", icon: GraduationCap },
  { id: "news", label: "News", icon: Newspaper },
  { id: "social", label: "Social", icon: MessageCircle },
] as const;

type FocusMode = (typeof FOCUS_MODES)[number]["id"];

const SUGGESTIONS = [
  "What are the best practices for gRPC in microservices?",
  "Compare PostgreSQL and MongoDB for time-series data",
  "Explain event sourcing like I'm five",
  "Latest breakthroughs in AI agents 2025",
  "How does Rust's ownership system work?",
  "Compare Next.js, Remix, and Astro for production",
];

// ── Thread storage ───────────────────────────────────────────────

interface ThreadMeta {
  id: string;
  title: string;
  timestamp: number;
}

function loadThreads(): ThreadMeta[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("anvil_threads") || "[]");
  } catch {
    return [];
  }
}

function saveThread(id: string, title: string) {
  if (typeof window === "undefined") return;
  const threads = loadThreads().filter((t) => t.id !== id);
  threads.unshift({ id, title: title.slice(0, 80), timestamp: Date.now() });
  localStorage.setItem("anvil_threads", JSON.stringify(threads.slice(0, 50)));
}

function deleteThread(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    "anvil_threads",
    JSON.stringify(loadThreads().filter((t) => t.id !== id)),
  );
}

// ── URL routing ──────────────────────────────────────────────────

function getThreadIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#\/thread\/(.+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

function navigateToThread(id: string) {
  window.history.pushState(null, "", `/#/thread/${encodeURIComponent(id)}`);
}

function navigateToHome() {
  window.history.pushState(null, "", "/");
}

// ── Main component ───────────────────────────────────────────────

export interface AnvilPerplexityProps {
  className?: string;
  defaultFocus?: FocusMode;
}

export function AnvilPerplexity({
  className,
  defaultFocus = "web",
}: AnvilPerplexityProps) {
  // SHARED EVENT STREAM — single source of truth
  const [sharedEvents, setSharedEvents] = useState<AnvilEvent[]>([]);
  const [threadId, setThreadId] = useState<string | null>(getThreadIdFromUrl);

  // Session hook — subscribes to events for the active session
  const session = useSession({
    sessionId: threadId ?? undefined,
    onEvent: (e) => {
      setSharedEvents((prev) => [...prev, e]);
    },
  });

  // Chat hook — derives messages from events
  const { messages } = useChat(session.sessionId, sharedEvents);

  // Agent state — for Reasoning/Steps display
  const agentState = useAgentState({ sharedEvents });

  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<FocusMode>(defaultFocus);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [threads, setThreads] = useState<ThreadMeta[]>(loadThreads);

  // ── Thread routing sync ──────────────────────────────────────

  // When URL hash changes (back/forward, deep-link, new tab), update state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlThread = getThreadIdFromUrl();
    if (urlThread !== threadId) {
      setSharedEvents([]);
      setThreadId(urlThread);
    }
  }, [typeof window !== "undefined" ? window.location.hash : null]);

  // Browser back/forward buttons
  useEffect(() => {
    const onPop = () => {
      const tid = getThreadIdFromUrl();
      if (tid !== threadId) {
        setSharedEvents([]);
        setThreadId(tid);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [threadId]);

  // ── Auto-focus input when idle ───────────────────────────────

  useEffect(() => {
    if (session.status === "idle" || session.status === "done") {
      inputRef.current?.focus();
    }
  }, [session.status]);

  // ── Save thread when done ────────────────────────────────────

  useEffect(() => {
    if (session.status === "done" && session.sessionId && messages.length > 0) {
      const firstMsg = messages.find((m) => m.role === "user");
      if (firstMsg) {
        saveThread(session.sessionId, firstMsg.content);
        setThreads(loadThreads());
      }
    }
  }, [session.status, session.sessionId, messages]);

  // ── Actions ──────────────────────────────────────────────────

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setInput("");
      setSharedEvents([]);
      try {
        const sid = await session.start(text);
        navigateToThread(sid);
        setThreadId(sid);
      } catch (err) {
        console.error("Failed to start session:", err);
      }
    },
    [session],
  );

  const newThread = useCallback(() => {
    navigateToHome();
    setThreadId(null);
    setSharedEvents([]);
    session.cancel();
    inputRef.current?.focus();
  }, [session]);

  const isRunning = session.status === "running" || session.status === "starting";
  const showLanding = session.status === "idle" && messages.length === 0;

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex h-full flex-col bg-background text-foreground",
          className,
        )}
      >
        {/* ── Top bar ──────────────────────────────────────────── */}
        <header className="flex h-10 sm:h-12 items-center justify-between border-b px-2 sm:px-4 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-foreground text-background shrink-0">
              <Search className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
            </div>
            <span className="text-xs sm:text-sm font-medium truncate">
              Anvil
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Perplexity
            </span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
                  onClick={() => {
                    setShowHistory(!showHistory);
                    setThreads(loadThreads());
                  }}
                >
                  <History className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              className="text-[10px] sm:text-xs h-7 sm:h-8"
              onClick={newThread}
            >
              <Plus className="mr-1 h-3 sm:h-3.5 w-3 sm:w-3.5" /> New thread
            </Button>
          </div>
        </header>

        {/* ── History sidebar ─────────────────────────────────── */}
        {showHistory && (
          <div className="border-b bg-card/50">
            <div className="mx-auto max-w-2xl lg:max-w-3xl px-2 sm:px-4 py-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Recent threads
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => setShowHistory(false)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {threads.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No previous threads
                </p>
              ) : (
                threads.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 group">
                    <button
                      type="button"
                      className="flex-1 text-left text-xs py-1.5 px-2 rounded hover:bg-accent/30 truncate"
                      onClick={() => {
                        navigateToThread(t.id);
                        setSharedEvents([]);
                        setThreadId(t.id);
                        setShowHistory(false);
                      }}
                    >
                      <span className="line-clamp-1">{t.title}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(t.timestamp).toLocaleDateString()}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        deleteThread(t.id);
                        setThreads(loadThreads());
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Messages ────────────────────────────────────────── */}
        <Conversation>
          {showLanding ? (
            <ConversationContent>
              <ConversationEmptyState
                title="Where knowledge begins"
                description="Ask anything. Anvil searches the web, reads the top sources, and writes a cited answer."
                icon={<Sparkles className="h-6 w-6" />}
              />
              <LandingSuggestions focus={focus} onFocusChange={setFocus} onSubmit={submit} />
            </ConversationContent>
          ) : (
            <ConversationContent>
              {messages.map((m, i) => (
                <MessageView
                  key={m.id}
                  msg={m}
                  isLast={i === messages.length - 1}
                  isRunning={isRunning}
                  agentState={agentState}
                  isFirstUser={isFirstUserAfterAssistant(messages, i)}
                />
              ))}
              {isRunning &&
                messages.filter((m) => m.role === "assistant").length === 0 && (
                  <Message from="assistant">
                    <MessageAvatar name="AI" />
                    <MessageContent variant="flat">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader size={14} />
                        <span>Thinking…</span>
                      </div>
                    </MessageContent>
                  </Message>
                )}
              {session.error && (
                <div className="mt-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-destructive">
                        Error
                      </div>
                      <div className="text-xs text-destructive/80 mt-1 break-words">
                        {session.error.message}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </ConversationContent>
          )}
        </Conversation>

        {/* ── Input bar ───────────────────────────────────────── */}
        <div
          className="border-t bg-background shrink-0"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}
        >
          <div className="p-2 sm:p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="mx-auto max-w-2xl lg:max-w-3xl"
            >
              <Card className="rounded-xl sm:rounded-2xl shadow-sm border">
                <div className="flex items-end gap-1.5 sm:gap-2 p-2 sm:p-3">
                  <Textarea
                    ref={inputRef as any}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask anything…"
                    rows={1}
                    disabled={isRunning}
                    enterKeyHint="send"
                    inputMode="text"
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    className="flex-1 min-h-[22px] sm:min-h-[24px] max-h-36 sm:max-h-48 resize-none border-0 shadow-none focus:outline-none bg-transparent px-1 text-sm leading-5 sm:leading-6 py-[3px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit(input);
                      }
                    }}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="hidden sm:flex items-center gap-1">
                      <FocusModeSelector
                        focus={focus}
                        onChange={setFocus}
                        disabled={isRunning}
                      />
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="submit"
                          size="icon"
                          disabled={!input.trim() || isRunning}
                          className="h-8 w-8 sm:h-9 sm:w-9 rounded-full shrink-0 active:scale-95 transition-transform"
                        >
                          <ArrowUp className="h-4 sm:h-[18px] w-4 sm:w-[18px]" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Send</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </Card>
              <div className="mt-1.5 sm:mt-2 text-center text-[9px] sm:text-[10px] text-muted-foreground px-2">
                Anvil can make mistakes. Verify important info.
              </div>
            </form>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function isFirstUserAfterAssistant(messages: ChatMessage[], i: number): boolean {
  // The message at i is the first assistant message in this run (preceded by a user msg)
  if (messages[i]?.role !== "assistant") return false;
  if (i === 0) return false;
  return messages[i - 1]?.role === "user";
}

// ── Message view ────────────────────────────────────────────────

function MessageView({
  msg,
  isLast,
  isRunning,
  agentState,
  isFirstUser,
}: {
  msg: ChatMessage;
  isLast: boolean;
  isRunning: boolean;
  agentState: ReturnType<typeof useAgentState>;
  isFirstUser: boolean;
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
    return null; // Tool bubbles hidden in this v2 — sources/reasoning take their place
  }
  return (
    <AssistantMessageView
      msg={msg}
      isLast={isLast}
      isRunning={isRunning}
      agentState={agentState}
      isFirstUser={isFirstUser}
    />
  );
}

function AssistantMessageView({
  msg,
  isLast,
  isRunning,
  agentState,
  isFirstUser,
}: {
  msg: ChatMessage;
  isLast: boolean;
  isRunning: boolean;
  agentState: ReturnType<typeof useAgentState>;
  isFirstUser: boolean;
}) {
  const sources = (msg as any).sources as Array<{
    id: number;
    url: string;
    title: string;
    domain: string;
  }> | undefined;
  const related = (msg as any).related as string[] | undefined;

  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [msg.content]);

  const reasoningSteps = useMemo(() => {
    return agentState.planSteps
      .filter((s) => s.status === "done")
      .map((s) => ({ label: s.intent, description: s.detail ?? "" }));
  }, [agentState.planSteps]);

  // Show Reasoning only on the first assistant message of the run,
  // and only when there's something to show (plan steps or active phase).
  const showReasoning = isFirstUser && reasoningSteps.length > 0;

  return (
    <Message from="assistant">
      <MessageAvatar name="AI" />
      <MessageContent variant="flat">
        {showReasoning && (
          <Reasoning isStreaming={isRunning} defaultOpen={isRunning}>
            <ReasoningTrigger
              title={`Reasoning (${reasoningSteps.length} step${reasoningSteps.length === 1 ? "" : "s"})`}
            />
            <ReasoningContent>
              <ol className="space-y-1.5 list-decimal pl-4">
                {reasoningSteps.map((s, i) => (
                  <li key={i} className="text-[11px] sm:text-xs">
                    <span className="font-medium">{s.label}</span>
                    {s.description && (
                      <span className="text-muted-foreground"> — {s.description}</span>
                    )}
                  </li>
                ))}
              </ol>
            </ReasoningContent>
          </Reasoning>
        )}

        {/* The actual answer */}
        {msg.content && (
          <div className="mt-1">
            <Response>{msg.content}</Response>
            {isRunning && (
              <span className="inline-block w-1.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-text-bottom" />
            )}
          </div>
        )}
        {!msg.content && isRunning && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader size={14} />
            <span>Thinking…</span>
          </div>
        )}

        {/* Sources — shown AFTER streaming ends, collapsible */}
        {sources && sources.length > 0 && !isRunning && (
          <Sources autoOpen count={sources.length}>
            <SourcesTrigger count={sources.length} />
            <SourcesContent>
              {sources.map((s) => (
                <Source key={s.id} href={s.url} title={s.title} domain={s.domain} />
              ))}
            </SourcesContent>
          </Sources>
        )}

        {/* Related questions */}
        {related && related.length > 0 && !isRunning && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {related.map((q, i) => (
              <button
                key={i}
                type="button"
                className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px] sm:text-xs hover:border-foreground/30 hover:bg-accent/30 transition-colors"
              >
                <Sparkles className="h-2.5 w-2.5 text-muted-foreground" />
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Actions — appear on the last completed assistant message */}
        {isLast && !isRunning && msg.content && (
          <Actions>
            <Action
              tooltip={copied ? "Copied" : "Copy"}
              label={copied ? "Copied" : "Copy"}
              icon={copied ? Check : Copy}
              onClick={onCopy}
            />
            <Action tooltip="Good answer" label="Good answer" icon={ThumbsUp} onClick={() => {}} />
            <Action tooltip="Bad answer" label="Bad answer" icon={ThumbsDown} onClick={() => {}} />
            <Action tooltip="Regenerate" label="Regenerate" icon={RotateCw} onClick={() => {}} />
          </Actions>
        )}
      </MessageContent>
    </Message>
  );
}

// ── Landing suggestions ─────────────────────────────────────────

function LandingSuggestions({
  focus,
  onFocusChange,
  onSubmit,
}: {
  focus: FocusMode;
  onFocusChange: (f: FocusMode) => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      <div className="flex justify-center">
        <FocusModeSelector focus={focus} onChange={onFocusChange} disabled={false} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSubmit(s)}
            className="text-left p-2.5 sm:p-3 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group active:scale-[0.98]"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs sm:text-sm line-clamp-2">{s}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Focus mode pills ────────────────────────────────────────────

function FocusModeSelector({
  focus,
  onChange,
  disabled,
}: {
  focus: FocusMode;
  onChange: (f: FocusMode) => void;
  disabled: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-1 flex-wrap justify-center")}>
      {FOCUS_MODES.map((m) => {
        const Icon = m.icon;
        const active = focus === m.id;
        return (
          <Tooltip key={m.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(m.id)}
                className={cn(
                  "inline-flex items-center gap-1 sm:gap-1.5 rounded-full px-2 sm:px-2.5 py-1 text-[10px] sm:text-xs font-medium transition-colors disabled:opacity-50 active:scale-95",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-2.5 sm:h-3 w-2.5 sm:w-3" />
                <span>{m.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Focus on {m.label.toLowerCase()} sources</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}


// ── Re-exports ──────────────────────────────────────────────────

// Headless primitives
export {
  AnvilProvider,
  useAnvil,
  useSession,
  useChat,
  useFrontendTool,
  useAgentState,
  type AnvilEvent,
  type ChatMessage,
} from "@anvil/react-headless";

// AI Elements components
export { Message, MessageContent, MessageAvatar } from "./components/ai-elements/message";
export { Conversation, ConversationContent, ConversationEmptyState } from "./components/ai-elements/conversation";
export { Response } from "./components/ai-elements/response";
export { Sources, SourcesTrigger, SourcesContent, Source } from "./components/ai-elements/sources";
export { Reasoning, ReasoningTrigger, ReasoningContent } from "./components/ai-elements/reasoning";
export { Loader } from "./components/ai-elements/loader";
export { Actions, Action } from "./components/ai-elements/actions";


// Unified Agent hook
export { useAgent } from "@anvil/react-headless";
export type { ToolHandler, UseAgentOptions, UseAgentReturn, PendingInterrupt } from "@anvil/react-headless";


// Zero-config Agent UI
export { AgentUI } from "./components/agent-ui";
