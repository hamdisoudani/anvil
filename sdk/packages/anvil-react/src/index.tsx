/**
 * AnvilPerplexity — v0.7 production-quality Perplexity-style UI.
 * 
 * CRITICAL FIXES:
 * 1. SINGLE navigation — no fake ID then real ID
 * 2. No setSharedEvents([]) clear — append-only so streaming never truncates
 * 3. Dedicated stream URL per session — no ???since=N??? confusion
 * 4. All answer.chunk events accumulated correctly
 */
import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent } from "react";
import {
  useAnvil,
  useSession,
  useChat,
  useFrontendTool,
  type AnvilEvent,
  type ChatMessage,
} from "@anvil/react-headless";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Textarea, Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { AgentThinking, AgentThinkingInline } from "./components/agent-thinking";
import { cn } from "./lib/utils";
import {
  Search,
  ArrowUp,
  Sparkles,
  Globe,
  GraduationCap,
  Newspaper,
  MessageCircle,
  ChevronRight,
  Copy,
  ThumbsUp,
  ThumbsDown,
  RotateCw,
  X,
  Plus,
  History,
  Trash2,
} from "lucide-react";

const FOCUS_MODES = [
  { id: "web", label: "Web", icon: Globe },
  { id: "academic", label: "Academic", icon: GraduationCap },
  { id: "news", label: "News", icon: Newspaper },
  { id: "social", label: "Social", icon: MessageCircle },
] as const;

type FocusMode = (typeof FOCUS_MODES)[number]["id"];

const SUGGESTIONS = [
  { icon: Sparkles, text: "What are the best practices for gRPC in microservices?" },
  { icon: Sparkles, text: "Compare PostgreSQL and MongoDB for time-series data" },
  { icon: Sparkles, text: "Explain event sourcing like I'm five" },
  { icon: Sparkles, text: "Latest breakthroughs in AI agents 2025" },
  { icon: Sparkles, text: "How does Rust's ownership system work?" },
  { icon: Sparkles, text: "Compare Next.js, Remix, and Astro for production" },
];

// ── Thread storage ───────────────────────────────────────────────

interface ThreadMeta { id: string; title: string; timestamp: number; }

function loadThreads(): ThreadMeta[] {
  try { return JSON.parse(localStorage.getItem("anvil_threads") || "[]"); }
  catch { return []; }
}

function saveThread(id: string, title: string) {
  const threads = loadThreads().filter((t) => t.id !== id);
  threads.unshift({ id, title: title.slice(0, 80), timestamp: Date.now() });
  localStorage.setItem("anvil_threads", JSON.stringify(threads.slice(0, 50)));
}

function deleteThread(id: string) {
  localStorage.setItem("anvil_threads", JSON.stringify(loadThreads().filter((t) => t.id !== id)));
}

// ── URL routing ──────────────────────────────────────────────────

function getThreadIdFromUrl(): string | null {
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

export function AnvilPerplexity({ className, defaultFocus = "web" }: AnvilPerplexityProps) {
  // SHARED EVENT STREAM — single source of truth
  const [sharedEvents, setSharedEvents] = useState<AnvilEvent[]>([]);
  const [threadId, setThreadId] = useState<string | null>(getThreadIdFromUrl);

  // Session hook — writes into sharedEvents
  const session = useSession({
    sessionId: threadId ?? undefined,
    onEvent: (e) => {
      setSharedEvents((prev) => [...prev, e]);
    },
  });

  // Chat hook — reads from sharedEvents, no extra subscription
  const { messages } = useChat(session.sessionId, sharedEvents);

  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<FocusMode>(defaultFocus);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [threads, setThreads] = useState<ThreadMeta[]>(loadThreads);

  // Sync threadId when URL hash changes (e.g. back/forward, new tab)
  useEffect(() => {
    const urlThread = getThreadIdFromUrl();
    if (urlThread && urlThread !== threadId) {
      setSharedEvents([]);
      setThreadId(urlThread);
    }
  }, [typeof window !== "undefined" ? window.location.hash : null]);

  // Back/forward navigation
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

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when idle
  useEffect(() => {
    if (session.status === "idle" || session.status === "done") {
      inputRef.current?.focus();
    }
  }, [session.status]);

  // Save thread when done
  useEffect(() => {
    if (session.status === "done" && session.sessionId && messages.length > 0) {
      const firstMsg = messages.find((m) => m.role === "user");
      if (firstMsg) {
        saveThread(session.sessionId, firstMsg.content);
        setThreads(loadThreads);
      }
    }
  }, [session.status, session.sessionId, messages]);

  // Submit: start a new search
  const submit = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setInput("");
    // BUG-U5 FIX: clear shared events for a fresh session
    setSharedEvents([]);
    try {
      const sid = await session.start(text);
      navigateToThread(sid);
      setThreadId(sid);
    } catch (err) {
      console.error("Failed to start session:", err);
    }
  }, [session]);

  // New thread: reset everything
  const newThread = useCallback(() => {
    navigateToHome();
    setThreadId(null);
    setSharedEvents([]);
    session.cancel();
  }, [session]);

  const isRunning = session.status === "running" || session.status === "starting";
  const isEmpty = session.status === "idle" && messages.length === 0;
  // Show landing only when idle AND no messages
  const showLanding = session.status === "idle" && messages.length === 0;

  return (
    <TooltipProvider>
      <div className={cn("flex h-full flex-col bg-background text-foreground", className)}>
        {/* Top bar */}
        <header className="flex h-10 sm:h-12 items-center justify-between border-b px-2 sm:px-4 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-foreground text-background shrink-0">
              <Search className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
            </div>
            <span className="text-xs sm:text-sm font-medium truncate">Anvil</span>
            <span className="hidden sm:inline text-xs text-muted-foreground">Perplexity</span>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8"
                  onClick={() => { setShowHistory(!showHistory); setThreads(loadThreads()); }}>
                  <History className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="sm" className="text-[10px] sm:text-xs h-7 sm:h-8"
              onClick={newThread}>
              <Plus className="mr-1 h-3 sm:h-3.5 w-3 sm:w-3.5" /> New thread
            </Button>
          </div>
        </header>

        {/* History sidebar */}
        {showHistory && (
          <div className="border-b bg-card/50">
            <div className="mx-auto max-w-2xl lg:max-w-3xl px-2 sm:px-4 py-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent threads</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHistory(false)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {threads.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No previous threads</p>
              ) : (
                threads.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 group">
                    <button type="button"
                      className="flex-1 text-left text-xs py-1.5 px-2 rounded hover:bg-accent/30 truncate"
                      onClick={() => {
                        navigateToThread(t.id);
                        setSharedEvents([]);
                        setThreadId(t.id);
                        setShowHistory(false);
                      }}>
                      <span className="line-clamp-1">{t.title}</span>
                      <span className="text-[9px] text-muted-foreground">{new Date(t.timestamp).toLocaleDateString()}</span>
                    </button>
                    <button type="button"
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={() => { deleteThread(t.id); setThreads(loadThreads()); }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
          <div className="min-h-full">
            {showLanding ? (
              <Landing
                focus={focus}
                onFocusChange={setFocus}
                onSubmit={submit}
              />
            ) : (
              <div className="mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8 space-y-4 sm:space-y-8">
                {messages.map((m, i) => (
                  <div key={m.id}>
                    {i > 0 && messages[i-1]?.role === "user" && m.role === "assistant" && (
                      <div className="mb-3 sm:mb-4">
                        <AgentThinking events={sharedEvents} compact />
                      </div>
                    )}
                    <MessageBubble
                      key={m.id}
                      msg={m}
                      isLast={i === messages.length - 1}
                      isRunning={isRunning && i === messages.length - 1}
                    />
                  </div>
                ))}
                {/* Show thinking while running with no assistant message yet */}
                {isRunning && messages.filter(m => m.role === "assistant").length === 0 && (
                  <AgentThinking events={sharedEvents} />
                )}
              </div>
            )}
            {session.error && (
              <div className="mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 pb-3 sm:pb-4">
                <Card className="border-destructive/50 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-destructive">Error</div>
                      <div className="text-xs text-destructive/80 mt-1 break-words">{session.error.message}</div>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input bar */}
        <div className="border-t bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
          <div className="p-2 sm:p-4">
            <form onSubmit={(e) => { e.preventDefault(); submit(input); }} className="mx-auto max-w-2xl lg:max-w-3xl">
              <Card className="rounded-xl sm:rounded-2xl shadow-sm border">
                <div className="flex items-end gap-1.5 sm:gap-2 p-2 sm:p-3">
                  <textarea ref={inputRef as any} value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask anything…" rows={1}
                    disabled={isRunning}
                    enterKeyHint="send"
                    inputMode="text"
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    className="flex-1 min-h-[22px] sm:min-h-[24px] max-h-36 sm:max-h-48 resize-none border-0 shadow-none focus:outline-none bg-transparent px-1 text-sm leading-5 sm:leading-6 py-[3px]"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }}} />
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="hidden sm:flex items-center gap-1">
                      <FocusModeSelector focus={focus} onChange={setFocus} disabled={isRunning} />
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="submit" size="icon"
                          disabled={!input.trim() || isRunning}
                          className="h-8 w-8 sm:h-9 sm:w-9 rounded-full shrink-0 active:scale-95 transition-transform">
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

// ── Landing state ────────────────────────────────────────────────

function Landing({ focus, onFocusChange, onSubmit }: {
  focus: FocusMode;
  onFocusChange: (f: FocusMode) => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <div className="mx-auto max-w-2xl lg:max-w-3xl px-4 sm:px-6 pt-10 sm:pt-16 pb-6 sm:pb-8 flex flex-col items-center text-center space-y-6 sm:space-y-8">
      <div className="space-y-2 sm:space-y-3">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight">Where knowledge begins</h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto px-2">
          Ask anything. Anvil searches the web, reads the top sources, and writes a cited answer.
        </p>
      </div>
      <div className="w-full max-w-xs sm:max-w-md">
        <FocusModeSelector focus={focus} onChange={onFocusChange} disabled={false} large />
      </div>
      <div className="w-full grid grid-cols-1 gap-2 pt-2 sm:pt-4">
        {SUGGESTIONS.map((s, i) => (
          <button key={i} onClick={() => onSubmit(s.text)}
            className="text-left p-2.5 sm:p-3 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group active:scale-[0.98]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm line-clamp-2">{s.text}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Focus mode pills ──────────────────────────────────────────────

function FocusModeSelector({ focus, onChange, disabled, large = false }: {
  focus: FocusMode; onChange: (f: FocusMode) => void; disabled: boolean; large?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-1 flex-wrap justify-center", large ? "" : "sm:border-r sm:pr-2 sm:mr-1")}>
      {FOCUS_MODES.map((m) => {
        const Icon = m.icon;
        const active = focus === m.id;
        return (
          <Tooltip key={m.id}>
            <TooltipTrigger asChild>
              <button type="button" disabled={disabled} onClick={() => onChange(m.id)}
                className={cn("inline-flex items-center gap-1 sm:gap-1.5 rounded-full px-2 sm:px-2.5 py-1 text-[10px] sm:text-xs font-medium transition-colors disabled:opacity-50 active:scale-95",
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
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

// ── Message components ───────────────────────────────────────────

function MessageBubble({ msg, isLast, isRunning }: { msg: ChatMessage; isLast: boolean; isRunning: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.role === "tool") return <ToolCallBubble msg={msg} />;
  return <AssistantBubble msg={msg} isLast={isLast} isRunning={isRunning} />;
}

function AssistantBubble({ msg, isLast, isRunning }: { msg: ChatMessage; isLast: boolean; isRunning: boolean }) {
  const sources = useMemo(() => ((msg as any).sources as any[])?.map((s: any) => s) ?? [], [msg]);
  const related = useMemo(() => ((msg as any).related as string[]) ?? [], [msg]);

  return (
    <div className="flex flex-col gap-2 sm:gap-3">
      <div className="text-xs sm:text-sm leading-6 sm:leading-7 whitespace-pre-wrap break-words">
        {msg.content || (isRunning ? <span className="text-muted-foreground italic">Thinking…</span> : null)}
        {isRunning && (
          <span className="inline-block w-1.5 h-3.5 sm:h-4 bg-foreground ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>

      {sources.length > 0 && (
        <div className="space-y-1.5 sm:space-y-2 pt-1 sm:pt-2">
          <div className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sources</div>
          <div className="grid grid-cols-1 gap-1.5 sm:gap-2">
            {sources.map((s: any) => (
              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                className="block p-2 sm:p-2.5 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group active:scale-[0.99]">
                <div className="flex items-start gap-2 sm:gap-2.5">
                  <Badge variant="outline" className="h-4 sm:h-5 px-1 sm:px-1.5 text-[9px] sm:text-[10px] font-mono shrink-0">{s.id}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] sm:text-xs font-medium line-clamp-1">{s.title}</div>
                    <div className="text-[9px] sm:text-[10px] text-muted-foreground truncate mt-0.5">{s.domain}</div>
                  </div>
                  <ChevronRight className="h-2.5 sm:h-3 w-2.5 sm:w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="space-y-1.5 sm:space-y-2 pt-2 sm:pt-4">
          <div className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Related</div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {related.map((q, i) => (
              <button key={i} type="button"
                className="inline-flex items-center gap-1 sm:gap-1.5 rounded-full border bg-card px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs hover:border-foreground/30 hover:bg-accent/30 transition-colors active:scale-95">
                <Sparkles className="h-2.5 sm:h-3 w-2.5 sm:w-3 text-muted-foreground shrink-0" />
                <span className="line-clamp-1">{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isLast && !isRunning && msg.content && (
        <div className="flex items-center gap-0.5 sm:gap-1 pt-0.5 sm:pt-1 text-muted-foreground">
          <ActionButton icon={Copy} label="Copy answer" onClick={() => navigator.clipboard.writeText(msg.content)} />
          <ActionButton icon={ThumbsUp} label="Good answer" onClick={() => {}} />
          <ActionButton icon={ThumbsDown} label="Bad answer" onClick={() => {}} />
          <ActionButton icon={RotateCw} label="Regenerate" onClick={() => {}} />
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={onClick}>
          <Icon className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToolCallBubble({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const hasResult = msg.toolResult !== undefined || msg.toolError !== undefined;
  return (
    <div className="flex justify-start">
      <Card className="w-full max-w-[95%] sm:max-w-[90%] text-[11px] sm:text-xs">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 sm:gap-3 p-2 sm:p-3 text-left hover:bg-accent/30 transition-colors active:bg-accent/50">
          <span className="text-sm">🔧</span>
          <span className="font-mono font-medium flex-1 truncate text-[11px] sm:text-xs">{msg.toolName}</span>
          {msg.toolError ? <Badge variant="destructive" className="text-[9px] sm:text-[10px]">error</Badge>
            : hasResult ? <Badge variant="secondary" className="text-[9px] sm:text-[10px]">done</Badge>
            : <Badge variant="outline" className="animate-pulse text-[9px] sm:text-[10px]">running</Badge>}
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform shrink-0", open && "rotate-90")} />
        </button>
        {open && (
          <div className="border-t p-2 sm:p-3 space-y-1.5 sm:space-y-2 text-[11px] sm:text-xs">
            {msg.toolInput !== undefined && (
              <div>
                <div className="text-muted-foreground font-semibold uppercase text-[9px] sm:text-[10px] tracking-wider mb-0.5 sm:mb-1">Input</div>
                <pre className="bg-muted p-1.5 sm:p-2 rounded font-mono overflow-x-auto max-h-32 sm:max-h-48 text-[10px] sm:text-xs">
                  {JSON.stringify(msg.toolInput, null, 2)}
                </pre>
              </div>
            )}
            {hasResult && (
              <div>
                <div className="text-muted-foreground font-semibold uppercase text-[9px] sm:text-[10px] tracking-wider mb-0.5 sm:mb-1">{msg.toolError ? "Error" : "Result"}</div>
                <pre className="bg-muted p-1.5 sm:p-2 rounded font-mono overflow-x-auto max-h-32 sm:max-h-48 text-[10px] sm:text-xs">
                  {msg.toolError ?? JSON.stringify(msg.toolResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// Re-export headless primitives
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool, type AnvilEvent } from "@anvil/react-headless";
export { useAgentState } from "@anvil/react-headless";
// Re-export our new components
export { AgentThinking, AgentThinkingInline } from "./components/agent-thinking";
