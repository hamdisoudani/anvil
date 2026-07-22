"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Message, MessageContent, MessageAvatar, } from "./ai-elements/message";
import { Conversation, ConversationContent, } from "./ai-elements/conversation";
import { Response } from "./ai-elements/response";
import { Sources, SourcesTrigger, SourcesContent, Source, } from "./ai-elements/sources";
import { Reasoning, ReasoningTrigger, ReasoningContent, } from "./ai-elements/reasoning";
import { Loader } from "./ai-elements/loader";
import { Actions, Action } from "./ai-elements/actions";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Textarea } from "./ui/input";
import { ErrorBanner } from "./ai-elements/error-banner";
import { AgentThinking } from "./agent-thinking";
import { ArrowUp, Sparkles, Copy, ThumbsUp, ThumbsDown, RotateCw, Check, Bot, Square, } from "lucide-react";
// ── Helpers ──────────────────────────────────────────────────────
function getActivityText(state) {
    const lastStep = state.planSteps[state.currentStepIndex];
    if (lastStep?.status === "running") {
        return lastStep.intent + (lastStep.detail ? `: ${lastStep.detail}` : "");
    }
    if (state.isStreaming)
        return "Writing answer…";
    if (state.phase === "done")
        return "Done";
    if (state.phase === "error")
        return state.error?.message ?? "Error";
    if (state.phase === "idle")
        return "";
    return state.phase;
}
function useAutoResizeTextarea(ref, value, maxPx = 160) {
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        el.style.height = "0px";
        el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    }, [ref, value, maxPx]);
}
// ── Interrupt Dialog ─────────────────────────────────────────────
function InterruptDialog({ interrupt, onApprove, onReject, }) {
    const [selected, setSelected] = React.useState(0);
    const [formData, setFormData] = React.useState({});
    const input = interrupt.input || {};
    const isApproval = input.reason === "approval" || interrupt.toolName.includes("approve");
    const isChoice = input.reason === "choice" || !!input.options;
    const isInput = input.reason === "input" || !!input.schema;
    if (isApproval) {
        return (_jsxs(Card, { className: "mx-auto my-4 max-w-md rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-4", children: [_jsx("p", { className: "mb-1 text-sm font-medium", children: input.title || "Approval required" }), _jsx("p", { className: "mb-3 text-xs text-muted-foreground sm:text-sm", children: input.message || interrupt.toolName }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove({ approved: true }), children: "Continue" })] })] }));
    }
    if (isChoice) {
        return (_jsxs(Card, { className: "mx-auto my-4 max-w-md rounded-xl border p-4", children: [_jsx("p", { className: "mb-2 text-sm font-medium", children: input.title || "Select an option" }), _jsx("div", { className: "mb-3 flex flex-wrap gap-2", children: (input.options || []).map((opt, i) => (_jsx(Button, { variant: selected === i ? "default" : "outline", size: "sm", onClick: () => setSelected(i), children: opt }, i))) }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove({ selected }), children: "Select" })] })] }));
    }
    if (isInput) {
        return (_jsxs(Card, { className: "mx-auto my-4 max-w-md rounded-xl border p-4", children: [_jsx("p", { className: "mb-2 text-sm font-medium", children: input.title || "Input required" }), input.schema?.properties &&
                    Object.keys(input.schema.properties).map((key) => (_jsxs("div", { className: "mb-2", children: [_jsx("label", { className: "text-[11px] text-muted-foreground", children: key }), _jsx(Textarea, { className: "min-h-[44px] text-sm", placeholder: input.schema.properties[key]?.description || key, value: formData[key] ?? "", onChange: (e) => setFormData((prev) => ({ ...prev, [key]: e.target.value })) })] }, key))), _jsxs("div", { className: "mt-2 flex justify-end gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove(formData), children: "Submit" })] })] }));
    }
    return (_jsxs(Card, { className: "mx-auto my-4 max-w-md rounded-xl border p-4", children: [_jsx("p", { className: "mb-1 text-sm font-medium", children: "Agent needs input" }), _jsxs("p", { className: "mb-3 text-xs text-muted-foreground", children: ["Tool: ", interrupt.toolName] }), _jsx("pre", { className: "mb-3 max-h-32 overflow-x-auto rounded bg-muted/50 p-2 text-[10px]", children: JSON.stringify(input, null, 2) }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove({}), children: "Continue" })] })] }));
}
// ── Message row ──────────────────────────────────────────────────
function MessageRow({ msg, index, messages, agent, renderTool, onSend, onRetry, }) {
    const isLast = index === messages.length - 1;
    const streaming = isLast && agent.isProcessing && msg.role === "assistant";
    const showThinking = msg.role === "assistant" &&
        index > 0 &&
        messages[index - 1]?.role === "user";
    if (msg.role === "user") {
        return (_jsxs(Message, { from: "user", children: [_jsx(MessageAvatar, { name: "You" }), _jsx(MessageContent, { children: msg.content })] }));
    }
    if (msg.role === "tool") {
        if (msg.toolName && renderTool[msg.toolName]) {
            return (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsx(MessageContent, { variant: "flat", children: renderTool[msg.toolName](msg) })] }));
        }
        return null;
    }
    // assistant
    return (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsxs(MessageContent, { variant: "flat", children: [showThinking && (_jsx("div", { className: "mb-2", children: isLast &&
                            (agent.isProcessing || agent.state.planSteps.length > 0) ? (_jsx(AgentThinking, { events: agent.events, defaultExpanded: streaming, compact: true })) : agent.state.planSteps.length > 0 ? (_jsxs(Reasoning, { isStreaming: false, defaultOpen: false, children: [_jsx(ReasoningTrigger, { title: `Reasoning (${agent.state.planSteps.length} step${agent.state.planSteps.length === 1 ? "" : "s"})` }), _jsx(ReasoningContent, { children: _jsx("ol", { className: "list-decimal space-y-1.5 pl-4", children: agent.state.planSteps
                                            .filter((s) => s.status === "done")
                                            .map((s, si) => (_jsxs("li", { className: "text-[11px] sm:text-xs", children: [_jsx("span", { className: "font-medium", children: s.intent }), s.detail && (_jsxs("span", { className: "text-muted-foreground", children: [" ", "\u2014 ", s.detail] }))] }, si))) }) })] })) : null })), msg.content ? (_jsxs("div", { className: "mt-1", children: [_jsx(Response, { children: msg.content }), streaming && (_jsx("span", { className: "ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-text-bottom" }))] })) : streaming ? (_jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: getActivityText(agent.state) || "Thinking…" })] })) : null, msg.sources && msg.sources.length > 0 && !streaming && (_jsx("div", { className: "mt-3", children: _jsxs(Sources, { autoOpen: isLast, count: msg.sources.length, children: [_jsx(SourcesTrigger, { count: msg.sources.length }), _jsx(SourcesContent, { children: msg.sources.map((s) => (_jsx(Source, { href: s.url, title: s.title, domain: s.domain }, s.id))) })] }) })), msg.related && msg.related.length > 0 && !streaming && (_jsx("div", { className: "mt-3 flex flex-wrap gap-1.5", children: msg.related.map((q, qi) => (_jsxs("button", { type: "button", className: "inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px] transition-colors hover:border-foreground/30 hover:bg-accent/30 sm:text-xs", onClick: () => onSend(q), children: [_jsx(Sparkles, { className: "h-2.5 w-2.5 text-muted-foreground" }), q] }, qi))) })), isLast && !streaming && msg.content && (_jsxs(Actions, { className: "mt-2", children: [_jsx(CopyButton, { text: msg.content }), _jsx(Action, { tooltip: "Good answer", label: "Good answer", icon: ThumbsUp, onClick: () => { } }), _jsx(Action, { tooltip: "Bad answer", label: "Bad answer", icon: ThumbsDown, onClick: () => { } }), _jsx(Action, { tooltip: "Regenerate", label: "Regenerate", icon: RotateCw, onClick: onRetry })] }))] })] }));
}
export function AgentUI({ agent, className, placeholder = "Ask anything…", renderTool = {}, emptyTitle = "Agent ready", emptyDescription = "Type a message to start a thread", }) {
    const [input, setInput] = React.useState("");
    const [sending, setSending] = React.useState(false);
    const inputRef = React.useRef(null);
    useAutoResizeTextarea(inputRef, input);
    React.useEffect(() => {
        if (!agent.isProcessing && !sending) {
            inputRef.current?.focus();
        }
    }, [agent.isProcessing, sending]);
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
        if (!text || agent.isProcessing || sending)
            return;
        setInput("");
        await sendInThread(text);
    }, [input, agent.isProcessing, sending, sendInThread]);
    const retryLast = React.useCallback(() => {
        const lastUser = [...agent.messages]
            .reverse()
            .find((m) => m.role === "user");
        if (lastUser?.content)
            void sendInThread(lastUser.content);
    }, [agent.messages, sendInThread]);
    const busy = agent.isProcessing || sending;
    const showEmpty = agent.messages.length === 0 && !busy;
    return (_jsxs("div", { className: cn("flex h-full min-h-0 flex-col bg-background text-foreground", className), children: [_jsx("div", { className: "min-h-0 flex-1 overflow-hidden", children: _jsx(Conversation, { className: "h-full", children: _jsxs(ConversationContent, { children: [showEmpty && (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 px-4 py-16 text-center sm:py-24", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-2xl bg-muted", children: _jsx(Bot, { className: "h-5 w-5 text-muted-foreground" }) }), _jsx("h2", { className: "text-lg font-semibold tracking-tight sm:text-xl", children: emptyTitle }), _jsx("p", { className: "max-w-md text-sm text-muted-foreground", children: emptyDescription })] })), agent.messages.map((msg, i) => (_jsx(MessageRow, { msg: msg, index: i, messages: agent.messages, agent: agent, renderTool: renderTool, onSend: (t) => void sendInThread(t), onRetry: retryLast }, msg.id))), agent.pendingInterrupt && (_jsx(InterruptDialog, { interrupt: agent.pendingInterrupt, onApprove: agent.approveInterrupt, onReject: () => agent.rejectInterrupt() })), busy &&
                                agent.messages.filter((m) => m.role === "assistant").length ===
                                    0 && (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsx(MessageContent, { variant: "flat", children: _jsxs("div", { className: "space-y-2", children: [_jsx(AgentThinking, { events: agent.events, defaultExpanded: true, compact: true }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: getActivityText(agent.state) || "Thinking…" })] })] }) })] })), agent.error && (_jsx("div", { className: "mt-3", children: _jsx(ErrorBanner, { error: {
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
                                            } }), _jsx(Button, { type: busy ? "button" : "submit", size: "icon", variant: busy ? "destructive" : "default", disabled: !busy && !input.trim(), onClick: busy ? () => agent.cancel() : undefined, className: "h-11 w-11 shrink-0 rounded-full transition-transform active:scale-95 sm:h-10 sm:w-10", "aria-label": busy ? "Stop" : "Send", children: busy ? (_jsx(Square, { className: "h-4 w-4 fill-current" })) : (_jsx(ArrowUp, { className: "h-5 w-5" })) })] }) }), _jsx("p", { className: "mt-2 px-2 text-center text-[10px] text-muted-foreground", children: agent.threadId
                                    ? `Thread ${agent.threadId.slice(0, 8)}… · Anvil can make mistakes`
                                    : "Anvil can make mistakes. Verify important info." })] }) }) })] }));
}
function CopyButton({ text }) {
    const [copied, setCopied] = React.useState(false);
    return (_jsx(Action, { tooltip: copied ? "Copied" : "Copy", label: "Copy", icon: copied ? Check : Copy, onClick: () => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } }));
}
//# sourceMappingURL=agent-ui.js.map