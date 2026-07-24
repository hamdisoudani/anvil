"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Message, MessageContent, MessageAvatar, } from "./ai-elements/message";
import { Conversation, ConversationContent, } from "./ai-elements/conversation";
import { Response } from "./ai-elements/response";
import { Sources, SourcesTrigger, SourcesContent, Source, } from "./ai-elements/sources";
import { Reasoning, ReasoningTrigger, ReasoningContent, } from "./ai-elements/reasoning";
import { Loader } from "./ai-elements/loader";
import { Actions, Action } from "./ai-elements/actions";
import { ErrorBanner } from "./ai-elements/error-banner";
import { AgentThinking } from "./agent-thinking";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Textarea } from "./ui/input";
import { ArrowUp, Square, Plus, Copy, Check, RotateCw, Sparkles, } from "lucide-react";
// ── Hooks ────────────────────────────────────────────────────────
function useAutoResizeTextarea(ref, value, maxPx = 160) {
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        el.style.height = "0px";
        el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    }, [ref, value, maxPx]);
}
// ── Component ────────────────────────────────────────────────────
export function ChatUI({ agent, className, placeholder = "Ask anything…", title = "Anvil", onNewThread, headerRight, emptyTitle = "What do you want to know?", emptyDescription = "Ask a question — I'll search, read sources, and answer with citations.", }) {
    const [input, setInput] = React.useState("");
    const [sending, setSending] = React.useState(false);
    const inputRef = React.useRef(null);
    const [copiedId, setCopiedId] = React.useState(null);
    useAutoResizeTextarea(inputRef, input);
    const busy = agent.isProcessing || sending;
    React.useEffect(() => {
        if (!busy)
            inputRef.current?.focus();
    }, [busy]);
    const sendInThread = React.useCallback(async (text) => {
        const trimmed = text.trim();
        if (!trimmed || agent.isProcessing || sending)
            return;
        setSending(true);
        try {
            await agent.send(trimmed, agent.threadId ? { threadId: agent.threadId } : undefined);
        }
        finally {
            setSending(false);
        }
    }, [agent, sending]);
    const submit = React.useCallback(async () => {
        const text = input.trim();
        if (!text || busy)
            return;
        setInput("");
        await sendInThread(text);
    }, [input, busy, sendInThread]);
    const handleNew = React.useCallback(() => {
        if (onNewThread)
            onNewThread();
        else
            agent.reset();
        setInput("");
        inputRef.current?.focus();
    }, [onNewThread, agent]);
    const retryLast = React.useCallback(() => {
        const lastUser = [...agent.messages]
            .reverse()
            .find((m) => m.role === "user");
        if (lastUser?.content)
            void sendInThread(lastUser.content);
    }, [agent.messages, sendInThread]);
    const showEmpty = agent.messages.length === 0 && !busy;
    return (_jsxs("div", { className: cn("flex h-full min-h-0 flex-col text-foreground", className), style: { background: "var(--anvil-bg, transparent)" }, children: [_jsxs("header", { className: "flex h-12 shrink-0 items-center justify-between border-b px-3 sm:h-14 sm:px-4", style: { paddingTop: "env(safe-area-inset-top, 0px)" }, children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [_jsx("div", { className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background", children: _jsx(Sparkles, { className: "h-3.5 w-3.5" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("span", { className: "block truncate text-sm font-semibold", children: title }), agent.threadId && (_jsxs("span", { className: "block truncate text-[10px] text-muted-foreground", children: ["thread ", agent.threadId.slice(0, 8), "\u2026"] }))] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [headerRight, _jsxs(Button, { type: "button", variant: "ghost", size: "sm", className: "h-10 min-w-10 px-3 text-xs sm:h-9", onClick: handleNew, children: [_jsx(Plus, { className: "mr-1 h-4 w-4" }), _jsx("span", { className: "hidden sm:inline", children: "New chat" })] })] })] }), _jsx("div", { className: "min-h-0 flex-1 overflow-hidden", children: _jsx(Conversation, { className: "h-full", style: { background: "var(--anvil-bg)" }, children: _jsxs(ConversationContent, { children: [showEmpty && (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 px-4 py-16 text-center sm:py-24", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-2xl bg-muted", children: _jsx(Sparkles, { className: "h-5 w-5 text-muted-foreground" }) }), _jsx("h2", { className: "text-lg font-semibold tracking-tight sm:text-xl", children: emptyTitle }), _jsx("p", { className: "max-w-md text-sm text-muted-foreground", children: emptyDescription })] })), agent.messages.map((msg, i) => (_jsx(ChatMessageRow, { msg: msg, isLast: i === agent.messages.length - 1, isProcessing: busy, agent: agent, showThinking: msg.role === "assistant" &&
                                    i > 0 &&
                                    agent.messages[i - 1]?.role === "user", copiedId: copiedId, onCopy: (id, content) => {
                                    void navigator.clipboard.writeText(content);
                                    setCopiedId(id);
                                    setTimeout(() => setCopiedId(null), 1500);
                                }, onRetry: retryLast }, msg.id))), busy &&
                                agent.messages.filter((m) => m.role === "assistant").length ===
                                    0 && (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsx(MessageContent, { variant: "flat", children: _jsxs("div", { className: "space-y-2", children: [_jsx(AgentThinking, { events: agent.events, defaultExpanded: true, compact: true }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: "Working\u2026" })] })] }) })] })), agent.error && (_jsx("div", { className: "mt-3", children: _jsx(ErrorBanner, { error: {
                                        message: agent.error,
                                        severity: "error",
                                        retryable: true,
                                    }, onRetry: retryLast }) }))] }) }) }), _jsx("div", { className: "shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80", style: { paddingBottom: "env(safe-area-inset-bottom, 8px)" }, children: _jsx("div", { className: "p-2 sm:p-4", children: _jsxs("form", { onSubmit: (e) => {
                            e.preventDefault();
                            void submit();
                        }, className: "mx-auto max-w-2xl lg:max-w-3xl", children: [_jsx(Card, { className: "rounded-2xl border shadow-sm", children: _jsxs("div", { className: "flex items-end gap-2 p-2 sm:p-3", children: [_jsx(Textarea, { ref: inputRef, value: input, onChange: (e) => setInput(e.target.value), placeholder: placeholder, rows: 1, disabled: busy, enterKeyHint: "send", className: "max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-base leading-6 shadow-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm", onKeyDown: (e) => {
                                                if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    void submit();
                                                }
                                            } }), _jsx(Button, { type: busy ? "button" : "submit", size: "icon", variant: busy ? "destructive" : "default", disabled: !busy && !input.trim(), onClick: busy ? () => agent.cancel() : undefined, className: "h-11 w-11 shrink-0 rounded-full transition-transform active:scale-95 sm:h-10 sm:w-10", "aria-label": busy ? "Stop" : "Send", children: busy ? (_jsx(Square, { className: "h-4 w-4 fill-current" })) : (_jsx(ArrowUp, { className: "h-5 w-5" })) })] }) }), _jsx("p", { className: "mt-2 px-2 text-center text-[10px] text-muted-foreground", children: "Anvil can make mistakes. Verify important info." })] }) }) })] }));
}
// ── Message row ──────────────────────────────────────────────────
function ChatMessageRow({ msg, isLast, isProcessing, agent, showThinking, copiedId, onCopy, onRetry, }) {
    if (msg.role === "user") {
        return (_jsxs(Message, { from: "user", children: [_jsx(MessageAvatar, { name: "You" }), _jsx(MessageContent, { children: msg.content })] }));
    }
    if (msg.role === "tool") {
        // Render tool calls with input and result
        const isFrontend = msg.toolName && msg.toolName === "change_background_color";
        return (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "Tool" }), _jsx(MessageContent, { variant: "flat", children: _jsxs("div", { className: "space-y-2 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { className: "font-mono px-2 py-0.5 rounded bg-muted", children: msg.toolName || "tool" }), _jsx("span", { className: "opacity-60", children: "\u2192" }), _jsx("span", { className: "font-mono text-xs", children: JSON.stringify(msg.toolInput).slice(0, 100) })] }), msg.toolResult && (_jsx("div", { className: "text-xs text-green-600 dark:text-green-400 font-mono", children: "Result: " + JSON.stringify(msg.toolResult).slice(0, 200) })), msg.toolError && (_jsxs("div", { className: "text-xs text-red-600 dark:text-red-400 font-mono", children: ["Error: ", String(msg.toolError).slice(0, 200)] }))] }) })] }));
    }
    const sources = msg.sources;
    const streaming = isLast && isProcessing;
    return (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsxs(MessageContent, { variant: "flat", children: [showThinking && (_jsx("div", { className: "mb-2", children: isLast &&
                            (agent.state.phase !== "idle" ||
                                agent.state.planSteps.length > 0 ||
                                isProcessing) ? (_jsx(AgentThinking, { events: agent.events, defaultExpanded: streaming, compact: true })) : (agent.state.planSteps.length > 0 && (_jsxs(Reasoning, { isStreaming: false, defaultOpen: false, children: [_jsx(ReasoningTrigger, { title: `Plan (${agent.state.planSteps.length} steps)` }), _jsx(ReasoningContent, { children: _jsx(AgentThinking, { events: agent.events, defaultExpanded: true, compact: true }) })] }))) })), msg.content && (_jsxs("div", { className: "mt-1", children: [_jsx(Response, { children: msg.content }), streaming && (_jsx("span", { className: "ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-text-bottom" }))] })), !msg.content && streaming && (_jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: "Thinking\u2026" })] })), sources && sources.length > 0 && !streaming && (_jsx("div", { className: "mt-3", children: _jsxs(Sources, { autoOpen: isLast, count: sources.length, children: [_jsx(SourcesTrigger, { count: sources.length }), _jsx(SourcesContent, { children: sources.map((s) => (_jsx(Source, { href: s.url, title: s.title, domain: s.domain }, s.id))) })] }) })), msg.content && !streaming && (_jsxs(Actions, { className: "mt-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100", children: [_jsx(Action, { label: "Copy", icon: copiedId === msg.id ? Check : Copy, onClick: () => onCopy(msg.id, msg.content) }), isLast && (_jsx(Action, { label: "Retry", icon: RotateCw, onClick: onRetry }))] }))] })] }));
}
//# sourceMappingURL=chat-ui.js.map