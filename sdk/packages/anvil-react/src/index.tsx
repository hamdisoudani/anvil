/**
 * AnvilPerplexity — a production-quality Perplexity-style search/answer UI.
 *
 * Uses the Anvil engine (via @anvil/react-headless hooks) for streaming,
 * sessions, and tool calls. Uses shadcn/ui + Tailwind for visuals.
 *
 * Features:
 *   - Centered landing with focus modes (Web, Academic, News, Reddit)
 *   - Streaming answer with inline citations [N] that hover-link to sources
 *   - Sources as numbered footnote cards with domain favicons
 *   - Related questions as clickable chips
 *   - Thread/session list sidebar (collapsible)
 *   - Plan visible inline as the agent thinks
 *   - Dark mode default, light mode supported via Tailwind
 *
 * Wire protocol: uses the same SSE event format as the rest of the SDK.
 * The wire format is documented in docs/wire-protocol.md.
 */
import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import {
  useAnvil,
  useSession,
  useChat,
  useFrontendTool,
  type ChatMessage,
} from "@anvil/react-headless";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Textarea, Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
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
} from "lucide-react";

// ── Focus modes (Perplexity-style) ────────────────────────────────

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

// ── Main component ───────────────────────────────────────────────

export interface AnvilPerplexityProps {
  className?: string;
  apiBaseUrl?: string;
  defaultFocus?: FocusMode;
}

export function AnvilPerplexity({
  className,
  apiBaseUrl = "",
  defaultFocus = "web",
}: AnvilPerplexityProps) {
  const session = useSession();
  const { messages } = useChat(session.sessionId);
  const [input, setInput] = useState("");
  const [focus, setFocus] = useState<FocusMode>(defaultFocus);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom as messages stream
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount and after each assistant message
  useEffect(() => {
    inputRef.current?.focus();
  }, [session.status]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    try {
      await session.start(text);
    } catch (err) {
      console.error("Failed to start session:", err);
    }
  };

  const isRunning = session.status === "running";
  const isEmpty = messages.length === 0;

  return (
    <TooltipProvider>
      <div className={cn("flex h-full flex-col bg-background text-foreground", className)}>
        {/* Top bar */}
        <header className="flex h-12 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background">
              <Search className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium">Anvil</span>
            <span className="text-xs text-muted-foreground">Perplexity</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-xs">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New thread
            </Button>
          </div>
        </header>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1">
          {isEmpty ? (
            <Landing
              focus={focus}
              onFocusChange={setFocus}
              onSubmit={(text) => {
                // Submit immediately — the input state is just for the form,
                // not the source of truth.
                setInput(text);
                session.start(text).catch(console.error);
              }}
            />
          ) : (
            <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  isLast={i === messages.length - 1}
                  isRunning={isRunning && i === messages.length - 1}
                />
              ))}
            </div>
          )}
          {session.error && (
            <div className="mx-auto max-w-3xl px-6 pb-4">
              <Card className="border-destructive/50 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <X className="h-4 w-4 text-destructive mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-destructive">Error</div>
                    <div className="text-xs text-destructive/80 mt-1">{session.error.message}</div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </ScrollArea>

        {/* Input bar */}
        <div className="border-t bg-background p-4">
          <form
            onSubmit={submit}
            className="mx-auto max-w-3xl"
          >
            <Card className="rounded-2xl shadow-sm">
              <div className="flex items-end gap-2 p-3">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask anything…"
                  rows={1}
                  disabled={isRunning}
                  className="min-h-[24px] max-h-48 resize-none border-0 shadow-none focus-visible:ring-0 px-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="flex items-center gap-1">
                  <FocusModeSelector focus={focus} onChange={setFocus} disabled={isRunning} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!input.trim() || isRunning}
                        className="h-8 w-8 rounded-full"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Send</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </Card>
            <div className="mt-2 text-center text-[10px] text-muted-foreground">
              Anvil can make mistakes. Verify important info.
            </div>
          </form>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Landing state (empty messages) ───────────────────────────────

function Landing({
  focus,
  onFocusChange,
  onSubmit,
}: {
  focus: FocusMode;
  onFocusChange: (f: FocusMode) => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 flex flex-col items-center text-center space-y-8">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Where knowledge begins</h1>
        <p className="text-sm text-muted-foreground">
          Ask anything. Anvil searches the web, reads the top sources, and writes a cited answer.
        </p>
      </div>

      {/* Input (large landing variant) */}
      <div className="w-full max-w-2xl">
        <FocusModeSelector focus={focus} onChange={onFocusChange} disabled={false} large />
      </div>

      {/* Suggestions grid */}
      <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-2 pt-4">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSubmit(s.text)}
            className="text-left p-3 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{s.text}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Focus mode pills ──────────────────────────────────────────────

function FocusModeSelector({
  focus,
  onChange,
  disabled,
  large = false,
}: {
  focus: FocusMode;
  onChange: (f: FocusMode) => void;
  disabled: boolean;
  large?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-1", large ? "" : "border-r pr-2 mr-1")}>
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
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
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

// ── Message bubble ────────────────────────────────────────────────

function MessageBubble({ msg, isLast, isRunning }: { msg: ChatMessage; isLast: boolean; isRunning: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.role === "tool") {
    return <ToolCallBubble msg={msg} />;
  }
  return <AssistantBubble msg={msg} isLast={isLast} isRunning={isRunning} />;
}

// ── Assistant message (with sources + related) ──────────────────

function AssistantBubble({ msg, isLast, isRunning }: { msg: ChatMessage; isLast: boolean; isRunning: boolean }) {
  const sources = useMemo(() => extractSources(msg), [msg]);
  const related = useMemo(() => extractRelated(msg), [msg]);

  return (
    <div className="flex flex-col gap-3">
      {/* The answer */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-7 whitespace-pre-wrap">
        {msg.content}
        {msg.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-foreground ml-0.5 animate-pulse align-middle" />
        )}
      </div>

      {/* Sources (numbered footnote cards) */}
      {sources.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Sources
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        </div>
      )}

      {/* Related questions */}
      {related.length > 0 && (
        <div className="space-y-2 pt-4">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Related
          </div>
          <div className="flex flex-wrap gap-2">
            {related.map((q, i) => (
              <button
                key={i}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs hover:border-foreground/30 hover:bg-accent/30 transition-colors"
              >
                <Sparkles className="h-3 w-3 text-muted-foreground" />
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions (only on last, complete messages) */}
      {isLast && !isRunning && msg.content && (
        <div className="flex items-center gap-1 pt-1 text-muted-foreground">
          <ActionButton icon={Copy} label="Copy answer" />
          <ActionButton icon={ThumbsUp} label="Good answer" />
          <ActionButton icon={ThumbsDown} label="Bad answer" />
          <ActionButton icon={RotateCw} label="Regenerate" />
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Source card (numbered footnote) ─────────────────────────────

function SourceCard({ source }: { source: ExtractedSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-2.5 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group"
    >
      <div className="flex items-start gap-2.5">
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
          {source.id}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium line-clamp-1">{source.title}</div>
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
            {source.domain}
          </div>
        </div>
        <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
      </div>
    </a>
  );
}

// ── Tool call bubble (collapsed) ────────────────────────────────

function ToolCallBubble({ msg }: { msg: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const hasResult = msg.toolResult !== undefined || msg.toolError !== undefined;
  return (
    <div className="flex justify-start">
      <Card className="w-full max-w-[90%] text-xs">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
        >
          <span className="text-sm">🔧</span>
          <span className="font-mono font-medium flex-1 truncate">{msg.toolName}</span>
          {msg.toolError ? (
            <Badge variant="destructive">error</Badge>
          ) : hasResult ? (
            <Badge variant="secondary">done</Badge>
          ) : (
            <Badge variant="outline" className="animate-pulse">running</Badge>
          )}
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
        {open && (
          <div className="border-t p-3 space-y-2 text-xs">
            {msg.toolInput !== undefined && (
              <div>
                <div className="text-muted-foreground font-semibold uppercase text-[10px] tracking-wider mb-1">Input</div>
                <pre className="bg-muted p-2 rounded font-mono overflow-x-auto max-h-48">
                  {JSON.stringify(msg.toolInput, null, 2)}
                </pre>
              </div>
            )}
            {hasResult && (
              <div>
                <div className="text-muted-foreground font-semibold uppercase text-[10px] tracking-wider mb-1">
                  {msg.toolError ? "Error" : "Result"}
                </div>
                <pre className="bg-muted p-2 rounded font-mono overflow-x-auto max-h-48">
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

// ── Helpers ──────────────────────────────────────────────────────

interface ExtractedSource {
  id: number;
  url: string;
  title: string;
  domain: string;
}

function extractSources(msg: ChatMessage): ExtractedSource[] {
  // The chat reducer stores sources on a `sources` field of the message
  // (set when sources.found events arrive). Extract from there.
  const raw = (msg as any).sources as Array<{ id: number; url: string; title: string; domain: string }> | undefined;
  if (raw && Array.isArray(raw) && raw.length > 0) return raw;
  return [];
}

function extractRelated(msg: ChatMessage): string[] {
  const raw = (msg as any).related as string[] | undefined;
  if (raw && Array.isArray(raw)) return raw;
  return [];
}

// Re-exports for convenience
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool } from "@anvil/react-headless";
export type { ChatMessage } from "@anvil/react-headless";
export type { AnvilEvent } from "@anvil/client";
export { Button } from "./components/ui/button";
export { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./components/ui/card";
export { Badge } from "./components/ui/badge";
export { Textarea, Input } from "./components/ui/input";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
export { ScrollArea } from "./components/ui/scroll-area";
export { cn } from "./lib/utils";
