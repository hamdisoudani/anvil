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
// ── Component ────────────────────────────────────────────────────
export function ChatUI({ agent, className, placeholder = "Ask anything…", title = "Anvil", onNewThread, headerRight, emptyTitle = "What do you want to know?", emptyDescription = "Ask a question — I'll search, read sources, and answer with citations.", }) {
    const [input, setInput] = React.useState("");
    const inputRef = React.useRef(null);
    const [copiedId, setCopiedId] = React.useState(null);
    React.useEffect(() => {
        if (!agent.isProcessing)
            inputRef.current?.focus();
    }, [agent.isProcessing]);
    const submit = React.useCallback(async () => {
        const text = input.trim();
        if (!text || agent.isProcessing)
            return;
        setInput("");
        await agent.send(text, agent.threadId ? { threadId: agent.threadId } : undefined);
    }, [input, agent]);
    const handleNew = React.useCallback(() => {
        if (onNewThread)
            onNewThread();
        else
            agent.reset();
        setInput("");
        inputRef.current?.focus();
    }, [onNewThread, agent]);
    const showEmpty = agent.messages.length === 0 && !agent.isProcessing;
    return (_jsxs("div", { className: cn("flex h-full min-h-0 flex-col bg-background text-foreground", className), children: [_jsxs("header", { className: "flex h-12 sm:h-14 items-center justify-between border-b px-3 sm:px-4 shrink-0", style: { paddingTop: "env(safe-area-inset-top, 0px)" }, children: [_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx("div", { className: "flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background shrink-0", children: _jsx(Sparkles, { className: "h-3.5 w-3.5" }) }), _jsx("span", { className: "text-sm font-semibold truncate", children: title })] }), _jsxs("div", { className: "flex items-center gap-1", children: [headerRight, _jsxs(Button, { type: "button", variant: "ghost", size: "sm", className: "h-10 min-w-10 sm:h-9 px-3 text-xs", onClick: handleNew, children: [_jsx(Plus, { className: "h-4 w-4 mr-1" }), _jsx("span", { className: "hidden sm:inline", children: "New chat" })] })] })] }), _jsx("div", { className: "flex-1 min-h-0 overflow-y-auto", children: _jsx(Conversation, { className: "h-full", children: _jsxs(ConversationContent, { children: [showEmpty && (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 py-16 sm:py-24 text-center px-4", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-2xl bg-muted", children: _jsx(Sparkles, { className: "h-5 w-5 text-muted-foreground" }) }), _jsx("h2", { className: "text-lg sm:text-xl font-semibold tracking-tight", children: emptyTitle }), _jsx("p", { className: "text-sm text-muted-foreground max-w-md", children: emptyDescription })] })), agent.messages.map((msg, i) => (_jsx(ChatMessageRow, { msg: msg, isLast: i === agent.messages.length - 1, isProcessing: agent.isProcessing, agent: agent, showThinking: msg.role === "assistant" &&
                                    i > 0 &&
                                    agent.messages[i - 1]?.role === "user" &&
                                    (i === agent.messages.length - 1 ||
                                        agent.messages[i + 1]?.role === "user"), copiedId: copiedId, onCopy: (id, content) => {
                                    void navigator.clipboard.writeText(content);
                                    setCopiedId(id);
                                    setTimeout(() => setCopiedId(null), 1500);
                                }, onRetry: () => {
                                    const lastUser = [...agent.messages]
                                        .reverse()
                                        .find((m) => m.role === "user");
                                    if (lastUser?.content) {
                                        void agent.send(lastUser.content, agent.threadId ? { threadId: agent.threadId } : undefined);
                                    }
                                } }, msg.id))), agent.isProcessing &&
                                agent.messages.filter((m) => m.role === "assistant").length === 0 && (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsx(MessageContent, { variant: "flat", children: _jsxs("div", { className: "space-y-2", children: [_jsx(AgentThinking, { events: agent.events, defaultExpanded: true, compact: true }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: "Working\u2026" })] })] }) })] })), agent.error && (_jsx("div", { className: "mt-3", children: _jsx(ErrorBanner, { error: {
                                        message: agent.error,
                                        severity: "error",
                                        retryable: true,
                                    }, onRetry: () => {
                                        const lastUser = [...agent.messages]
                                            .reverse()
                                            .find((m) => m.role === "user");
                                        if (lastUser?.content) {
                                            void agent.send(lastUser.content, agent.threadId ? { threadId: agent.threadId } : undefined);
                                        }
                                    } }) }))] }) }) }), _jsx("div", { className: "border-t bg-background shrink-0", style: { paddingBottom: "env(safe-area-inset-bottom, 8px)" }, children: _jsx("div", { className: "p-2 sm:p-4", children: _jsxs("form", { onSubmit: (e) => {
                            e.preventDefault();
                            void submit();
                        }, className: "mx-auto max-w-2xl lg:max-w-3xl", children: [_jsx(Card, { className: "rounded-2xl shadow-sm border", children: _jsxs("div", { className: "flex items-end gap-2 p-2 sm:p-3", children: [_jsx(Textarea, { ref: inputRef, value: input, onChange: (e) => setInput(e.target.value), placeholder: placeholder, rows: 1, disabled: agent.isProcessing, enterKeyHint: "send", className: "flex-1 min-h-[44px] max-h-40 resize-none border-0 shadow-none focus:outline-none bg-transparent px-2 text-base sm:text-sm leading-6 py-2.5", onKeyDown: (e) => {
                                                if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    void submit();
                                                }
                                            } }), _jsx(Button, { type: agent.isProcessing ? "button" : "submit", size: "icon", variant: agent.isProcessing ? "destructive" : "default", disabled: !agent.isProcessing && !input.trim(), onClick: agent.isProcessing
                                                ? () => agent.cancel()
                                                : undefined, className: "h-11 w-11 sm:h-10 sm:w-10 rounded-full shrink-0 active:scale-95 transition-transform", "aria-label": agent.isProcessing ? "Stop" : "Send", children: agent.isProcessing ? (_jsx(Square, { className: "h-4 w-4 fill-current" })) : (_jsx(ArrowUp, { className: "h-5 w-5" })) })] }) }), _jsx("p", { className: "mt-2 text-center text-[10px] text-muted-foreground px-2", children: "Anvil can make mistakes. Verify important info." })] }) }) })] }));
}
// ── Message row ──────────────────────────────────────────────────
function ChatMessageRow({ msg, isLast, isProcessing, agent, showThinking, copiedId, onCopy, onRetry, }) {
    if (msg.role === "user") {
        return (_jsxs(Message, { from: "user", children: [_jsx(MessageAvatar, { name: "You" }), _jsx(MessageContent, { children: msg.content })] }));
    }
    if (msg.role === "tool")
        return null;
    const sources = msg.sources;
    const streaming = isLast && isProcessing;
    return (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsxs(MessageContent, { variant: "flat", children: [showThinking && (_jsx("div", { className: "mb-2", children: isLast && (agent.state.phase !== "idle" || agent.state.planSteps.length > 0) ? (_jsx(AgentThinking, { events: agent.events, defaultExpanded: streaming, compact: true })) : (agent.state.planSteps.length > 0 && (_jsxs(Reasoning, { isStreaming: false, defaultOpen: false, children: [_jsx(ReasoningTrigger, { title: `Plan (${agent.state.planSteps.length} steps)` }), _jsx(ReasoningContent, { children: _jsx(AgentThinking, { events: agent.events, defaultExpanded: true, compact: true }) })] }))) })), msg.content && (_jsxs("div", { className: "mt-1", children: [_jsx(Response, { children: msg.content }), streaming && (_jsx("span", { className: "inline-block w-1.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-text-bottom" }))] })), sources && sources.length > 0 && !streaming && (_jsx("div", { className: "mt-3", children: _jsxs(Sources, { autoOpen: isLast, count: sources.length, children: [_jsx(SourcesTrigger, { count: sources.length }), _jsx(SourcesContent, { children: sources.map((s) => (_jsx(Source, { href: s.url, title: s.title, domain: s.domain }, s.id))) })] }) })), msg.content && !streaming && (_jsxs(Actions, { className: "mt-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100", children: [_jsx(Action, { label: "Copy", icon: copiedId === msg.id ? Check : Copy, onClick: () => onCopy(msg.id, msg.content) }), isLast && (_jsx(Action, { label: "Retry", icon: RotateCw, onClick: onRetry }))] }))] })] }));
}
//# sourceMappingURL=chat-ui.js.map