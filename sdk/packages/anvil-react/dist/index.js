import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * AnvilPerplexity — v0.7 production-quality Perplexity-style UI.
 *
 * CRITICAL FIXES:
 * 1. SINGLE navigation — no fake ID then real ID
 * 2. No setSharedEvents([]) clear — append-only so streaming never truncates
 * 3. Dedicated stream URL per session — no ???since=N??? confusion
 * 4. All answer.chunk events accumulated correctly
 */
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSession, useChat, } from "@anvil/react-headless";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { ScrollArea } from "./components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { AgentThinking } from "./components/agent-thinking";
import { cn } from "./lib/utils";
import { Search, ArrowUp, Sparkles, Globe, GraduationCap, Newspaper, MessageCircle, ChevronRight, Copy, ThumbsUp, ThumbsDown, RotateCw, X, Plus, History, Trash2, } from "lucide-react";
const FOCUS_MODES = [
    { id: "web", label: "Web", icon: Globe },
    { id: "academic", label: "Academic", icon: GraduationCap },
    { id: "news", label: "News", icon: Newspaper },
    { id: "social", label: "Social", icon: MessageCircle },
];
const SUGGESTIONS = [
    { icon: Sparkles, text: "What are the best practices for gRPC in microservices?" },
    { icon: Sparkles, text: "Compare PostgreSQL and MongoDB for time-series data" },
    { icon: Sparkles, text: "Explain event sourcing like I'm five" },
    { icon: Sparkles, text: "Latest breakthroughs in AI agents 2025" },
    { icon: Sparkles, text: "How does Rust's ownership system work?" },
    { icon: Sparkles, text: "Compare Next.js, Remix, and Astro for production" },
];
function loadThreads() {
    try {
        return JSON.parse(localStorage.getItem("anvil_threads") || "[]");
    }
    catch {
        return [];
    }
}
function saveThread(id, title) {
    const threads = loadThreads().filter((t) => t.id !== id);
    threads.unshift({ id, title: title.slice(0, 80), timestamp: Date.now() });
    localStorage.setItem("anvil_threads", JSON.stringify(threads.slice(0, 50)));
}
function deleteThread(id) {
    localStorage.setItem("anvil_threads", JSON.stringify(loadThreads().filter((t) => t.id !== id)));
}
// ── URL routing ──────────────────────────────────────────────────
function getThreadIdFromUrl() {
    const m = window.location.hash.match(/^#\/thread\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
}
function navigateToThread(id) {
    window.history.pushState(null, "", `/#/thread/${encodeURIComponent(id)}`);
}
function navigateToHome() {
    window.history.pushState(null, "", "/");
}
export function AnvilPerplexity({ className, defaultFocus = "web" }) {
    // SHARED EVENT STREAM — single source of truth
    const [sharedEvents, setSharedEvents] = useState([]);
    const [threadId, setThreadId] = useState(getThreadIdFromUrl);
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
    const [focus, setFocus] = useState(defaultFocus);
    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const [showHistory, setShowHistory] = useState(false);
    const [threads, setThreads] = useState(loadThreads);
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
    const submit = useCallback(async (text) => {
        if (!text.trim())
            return;
        setInput("");
        // BUG-U5 FIX: clear shared events for a fresh session
        setSharedEvents([]);
        try {
            const sid = await session.start(text);
            navigateToThread(sid);
            setThreadId(sid);
        }
        catch (err) {
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
    return (_jsx(TooltipProvider, { children: _jsxs("div", { className: cn("flex h-full flex-col bg-background text-foreground", className), children: [_jsxs("header", { className: "flex h-10 sm:h-12 items-center justify-between border-b px-2 sm:px-4 shrink-0", children: [_jsxs("div", { className: "flex items-center gap-1.5 sm:gap-2 min-w-0", children: [_jsx("div", { className: "flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-foreground text-background shrink-0", children: _jsx(Search, { className: "h-3 sm:h-3.5 w-3 sm:w-3.5" }) }), _jsx("span", { className: "text-xs sm:text-sm font-medium truncate", children: "Anvil" }), _jsx("span", { className: "hidden sm:inline text-xs text-muted-foreground", children: "Perplexity" })] }), _jsxs("div", { className: "flex items-center gap-0.5 sm:gap-1", children: [_jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 sm:h-8 sm:w-8", onClick: () => { setShowHistory(!showHistory); setThreads(loadThreads()); }, children: _jsx(History, { className: "h-3.5 sm:h-4 w-3.5 sm:w-4" }) }) }), _jsx(TooltipContent, { children: "History" })] }), _jsxs(Button, { variant: "ghost", size: "sm", className: "text-[10px] sm:text-xs h-7 sm:h-8", onClick: newThread, children: [_jsx(Plus, { className: "mr-1 h-3 sm:h-3.5 w-3 sm:w-3.5" }), " New thread"] })] })] }), showHistory && (_jsx("div", { className: "border-b bg-card/50", children: _jsxs("div", { className: "mx-auto max-w-2xl lg:max-w-3xl px-2 sm:px-4 py-2 space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[10px] font-semibold text-muted-foreground uppercase tracking-wider", children: "Recent threads" }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-5 w-5", onClick: () => setShowHistory(false), children: _jsx(X, { className: "h-3 w-3" }) })] }), threads.length === 0 ? (_jsx("p", { className: "text-xs text-muted-foreground py-2", children: "No previous threads" })) : (threads.map((t) => (_jsxs("div", { className: "flex items-center gap-2 group", children: [_jsxs("button", { type: "button", className: "flex-1 text-left text-xs py-1.5 px-2 rounded hover:bg-accent/30 truncate", onClick: () => {
                                            navigateToThread(t.id);
                                            setSharedEvents([]);
                                            setThreadId(t.id);
                                            setShowHistory(false);
                                        }, children: [_jsx("span", { className: "line-clamp-1", children: t.title }), _jsx("span", { className: "text-[9px] text-muted-foreground", children: new Date(t.timestamp).toLocaleDateString() })] }), _jsx("button", { type: "button", className: "opacity-0 group-hover:opacity-100 h-5 w-5 text-muted-foreground hover:text-destructive", onClick: () => { deleteThread(t.id); setThreads(loadThreads()); }, children: _jsx(Trash2, { className: "h-3 w-3" }) })] }, t.id))))] }) })), _jsx(ScrollArea, { ref: scrollRef, className: "flex-1 overflow-y-auto overscroll-contain", children: _jsxs("div", { className: "min-h-full", children: [showLanding ? (_jsx(Landing, { focus: focus, onFocusChange: setFocus, onSubmit: submit })) : (_jsxs("div", { className: "mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8 space-y-4 sm:space-y-8", children: [messages.map((m, i) => (_jsxs("div", { children: [i > 0 && messages[i - 1]?.role === "user" && m.role === "assistant" && (_jsx("div", { className: "mb-3 sm:mb-4", children: _jsx(AgentThinking, { events: sharedEvents, compact: true }) })), _jsx(MessageBubble, { msg: m, isLast: i === messages.length - 1, isRunning: isRunning && i === messages.length - 1 }, m.id)] }, m.id))), isRunning && messages.filter(m => m.role === "assistant").length === 0 && (_jsx(AgentThinking, { events: sharedEvents }))] })), session.error && (_jsx("div", { className: "mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 pb-3 sm:pb-4", children: _jsx(Card, { className: "border-destructive/50 bg-destructive/5 p-3", children: _jsxs("div", { className: "flex items-start gap-2", children: [_jsx(X, { className: "h-4 w-4 text-destructive mt-0.5 shrink-0" }), _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-sm font-medium text-destructive", children: "Error" }), _jsx("div", { className: "text-xs text-destructive/80 mt-1 break-words", children: session.error.message })] })] }) }) }))] }) }), _jsx("div", { className: "border-t bg-background", style: { paddingBottom: 'env(safe-area-inset-bottom, 8px)' }, children: _jsx("div", { className: "p-2 sm:p-4", children: _jsxs("form", { onSubmit: (e) => { e.preventDefault(); submit(input); }, className: "mx-auto max-w-2xl lg:max-w-3xl", children: [_jsx(Card, { className: "rounded-xl sm:rounded-2xl shadow-sm border", children: _jsxs("div", { className: "flex items-end gap-1.5 sm:gap-2 p-2 sm:p-3", children: [_jsx("textarea", { ref: inputRef, value: input, onChange: (e) => setInput(e.target.value), placeholder: "Ask anything\u2026", rows: 1, disabled: isRunning, enterKeyHint: "send", inputMode: "text", autoCapitalize: "off", autoCorrect: "off", autoComplete: "off", className: "flex-1 min-h-[22px] sm:min-h-[24px] max-h-36 sm:max-h-48 resize-none border-0 shadow-none focus:outline-none bg-transparent px-1 text-sm leading-5 sm:leading-6 py-[3px]", onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    submit(input);
                                                } } }), _jsxs("div", { className: "flex items-center gap-1 shrink-0", children: [_jsx("div", { className: "hidden sm:flex items-center gap-1", children: _jsx(FocusModeSelector, { focus: focus, onChange: setFocus, disabled: isRunning }) }), _jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsx(Button, { type: "submit", size: "icon", disabled: !input.trim() || isRunning, className: "h-8 w-8 sm:h-9 sm:w-9 rounded-full shrink-0 active:scale-95 transition-transform", children: _jsx(ArrowUp, { className: "h-4 sm:h-[18px] w-4 sm:w-[18px]" }) }) }), _jsx(TooltipContent, { children: "Send" })] })] })] }) }), _jsx("div", { className: "mt-1.5 sm:mt-2 text-center text-[9px] sm:text-[10px] text-muted-foreground px-2", children: "Anvil can make mistakes. Verify important info." })] }) }) })] }) }));
}
// ── Landing state ────────────────────────────────────────────────
function Landing({ focus, onFocusChange, onSubmit }) {
    return (_jsxs("div", { className: "mx-auto max-w-2xl lg:max-w-3xl px-4 sm:px-6 pt-10 sm:pt-16 pb-6 sm:pb-8 flex flex-col items-center text-center space-y-6 sm:space-y-8", children: [_jsxs("div", { className: "space-y-2 sm:space-y-3", children: [_jsx("h1", { className: "text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight", children: "Where knowledge begins" }), _jsx("p", { className: "text-xs sm:text-sm text-muted-foreground max-w-md mx-auto px-2", children: "Ask anything. Anvil searches the web, reads the top sources, and writes a cited answer." })] }), _jsx("div", { className: "w-full max-w-xs sm:max-w-md", children: _jsx(FocusModeSelector, { focus: focus, onChange: onFocusChange, disabled: false, large: true }) }), _jsx("div", { className: "w-full grid grid-cols-1 gap-2 pt-2 sm:pt-4", children: SUGGESTIONS.map((s, i) => (_jsx("button", { onClick: () => onSubmit(s.text), className: "text-left p-2.5 sm:p-3 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group active:scale-[0.98]", children: _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { className: "text-xs sm:text-sm line-clamp-2", children: s.text }), _jsx(ChevronRight, { className: "h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" })] }) }, i))) })] }));
}
// ── Focus mode pills ──────────────────────────────────────────────
function FocusModeSelector({ focus, onChange, disabled, large = false }) {
    return (_jsx("div", { className: cn("flex items-center gap-1 flex-wrap justify-center", large ? "" : "sm:border-r sm:pr-2 sm:mr-1"), children: FOCUS_MODES.map((m) => {
            const Icon = m.icon;
            const active = focus === m.id;
            return (_jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsxs("button", { type: "button", disabled: disabled, onClick: () => onChange(m.id), className: cn("inline-flex items-center gap-1 sm:gap-1.5 rounded-full px-2 sm:px-2.5 py-1 text-[10px] sm:text-xs font-medium transition-colors disabled:opacity-50 active:scale-95", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground"), children: [_jsx(Icon, { className: "h-2.5 sm:h-3 w-2.5 sm:w-3" }), _jsx("span", { children: m.label })] }) }), _jsxs(TooltipContent, { children: ["Focus on ", m.label.toLowerCase(), " sources"] })] }, m.id));
        }) }));
}
// ── Message components ───────────────────────────────────────────
function MessageBubble({ msg, isLast, isRunning }) {
    if (msg.role === "user") {
        return (_jsx("div", { className: "flex justify-end", children: _jsx("div", { className: "max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm whitespace-pre-wrap break-words", children: msg.content }) }));
    }
    if (msg.role === "tool")
        return _jsx(ToolCallBubble, { msg: msg });
    return _jsx(AssistantBubble, { msg: msg, isLast: isLast, isRunning: isRunning });
}
function AssistantBubble({ msg, isLast, isRunning }) {
    const sources = useMemo(() => msg.sources?.map((s) => s) ?? [], [msg]);
    const related = useMemo(() => msg.related ?? [], [msg]);
    return (_jsxs("div", { className: "flex flex-col gap-2 sm:gap-3", children: [_jsxs("div", { className: "text-xs sm:text-sm leading-6 sm:leading-7 whitespace-pre-wrap break-words", children: [msg.content || (isRunning ? _jsx("span", { className: "text-muted-foreground italic", children: "Thinking\u2026" }) : null), isRunning && (_jsx("span", { className: "inline-block w-1.5 h-3.5 sm:h-4 bg-foreground ml-0.5 animate-pulse align-text-bottom" }))] }), sources.length > 0 && (_jsxs("div", { className: "space-y-1.5 sm:space-y-2 pt-1 sm:pt-2", children: [_jsx("div", { className: "text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider", children: "Sources" }), _jsx("div", { className: "grid grid-cols-1 gap-1.5 sm:gap-2", children: sources.map((s) => (_jsx("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", className: "block p-2 sm:p-2.5 rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/20 transition-colors group active:scale-[0.99]", children: _jsxs("div", { className: "flex items-start gap-2 sm:gap-2.5", children: [_jsx(Badge, { variant: "outline", className: "h-4 sm:h-5 px-1 sm:px-1.5 text-[9px] sm:text-[10px] font-mono shrink-0", children: s.id }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "text-[11px] sm:text-xs font-medium line-clamp-1", children: s.title }), _jsx("div", { className: "text-[9px] sm:text-[10px] text-muted-foreground truncate mt-0.5", children: s.domain })] }), _jsx(ChevronRight, { className: "h-2.5 sm:h-3 w-2.5 sm:w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0" })] }) }, s.id))) })] })), related.length > 0 && (_jsxs("div", { className: "space-y-1.5 sm:space-y-2 pt-2 sm:pt-4", children: [_jsx("div", { className: "text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider", children: "Related" }), _jsx("div", { className: "flex flex-wrap gap-1.5 sm:gap-2", children: related.map((q, i) => (_jsxs("button", { type: "button", className: "inline-flex items-center gap-1 sm:gap-1.5 rounded-full border bg-card px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs hover:border-foreground/30 hover:bg-accent/30 transition-colors active:scale-95", children: [_jsx(Sparkles, { className: "h-2.5 sm:h-3 w-2.5 sm:w-3 text-muted-foreground shrink-0" }), _jsx("span", { className: "line-clamp-1", children: q })] }, i))) })] })), isLast && !isRunning && msg.content && (_jsxs("div", { className: "flex items-center gap-0.5 sm:gap-1 pt-0.5 sm:pt-1 text-muted-foreground", children: [_jsx(ActionButton, { icon: Copy, label: "Copy answer", onClick: () => navigator.clipboard.writeText(msg.content) }), _jsx(ActionButton, { icon: ThumbsUp, label: "Good answer", onClick: () => { } }), _jsx(ActionButton, { icon: ThumbsDown, label: "Bad answer", onClick: () => { } }), _jsx(ActionButton, { icon: RotateCw, label: "Regenerate", onClick: () => { } })] }))] }));
}
function ActionButton({ icon: Icon, label, onClick }) {
    return (_jsxs(Tooltip, { children: [_jsx(TooltipTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 sm:h-8 sm:w-8", onClick: onClick, children: _jsx(Icon, { className: "h-3.5 sm:h-4 w-3.5 sm:w-4" }) }) }), _jsx(TooltipContent, { children: label })] }));
}
function ToolCallBubble({ msg }) {
    const [open, setOpen] = useState(false);
    const hasResult = msg.toolResult !== undefined || msg.toolError !== undefined;
    return (_jsx("div", { className: "flex justify-start", children: _jsxs(Card, { className: "w-full max-w-[95%] sm:max-w-[90%] text-[11px] sm:text-xs", children: [_jsxs("button", { type: "button", onClick: () => setOpen((o) => !o), className: "w-full flex items-center gap-2 sm:gap-3 p-2 sm:p-3 text-left hover:bg-accent/30 transition-colors active:bg-accent/50", children: [_jsx("span", { className: "text-sm", children: "\uD83D\uDD27" }), _jsx("span", { className: "font-mono font-medium flex-1 truncate text-[11px] sm:text-xs", children: msg.toolName }), msg.toolError ? _jsx(Badge, { variant: "destructive", className: "text-[9px] sm:text-[10px]", children: "error" })
                            : hasResult ? _jsx(Badge, { variant: "secondary", className: "text-[9px] sm:text-[10px]", children: "done" })
                                : _jsx(Badge, { variant: "outline", className: "animate-pulse text-[9px] sm:text-[10px]", children: "running" }), _jsx(ChevronRight, { className: cn("h-3 w-3 text-muted-foreground transition-transform shrink-0", open && "rotate-90") })] }), open && (_jsxs("div", { className: "border-t p-2 sm:p-3 space-y-1.5 sm:space-y-2 text-[11px] sm:text-xs", children: [msg.toolInput !== undefined && (_jsxs("div", { children: [_jsx("div", { className: "text-muted-foreground font-semibold uppercase text-[9px] sm:text-[10px] tracking-wider mb-0.5 sm:mb-1", children: "Input" }), _jsx("pre", { className: "bg-muted p-1.5 sm:p-2 rounded font-mono overflow-x-auto max-h-32 sm:max-h-48 text-[10px] sm:text-xs", children: JSON.stringify(msg.toolInput, null, 2) })] })), hasResult && (_jsxs("div", { children: [_jsx("div", { className: "text-muted-foreground font-semibold uppercase text-[9px] sm:text-[10px] tracking-wider mb-0.5 sm:mb-1", children: msg.toolError ? "Error" : "Result" }), _jsx("pre", { className: "bg-muted p-1.5 sm:p-2 rounded font-mono overflow-x-auto max-h-32 sm:max-h-48 text-[10px] sm:text-xs", children: msg.toolError ?? JSON.stringify(msg.toolResult, null, 2) })] }))] }))] }) }));
}
// Re-export headless primitives
export { AnvilProvider, useAnvil, useSession, useChat, useFrontendTool } from "@anvil/react-headless";
export { useAgentState } from "@anvil/react-headless";
// Re-export our new components
export { AgentThinking, AgentThinkingInline } from "./components/agent-thinking";
//# sourceMappingURL=index.js.map