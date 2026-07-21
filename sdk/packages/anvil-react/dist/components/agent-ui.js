"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Message, MessageContent, MessageAvatar, } from "./ai-elements/message";
import { Response } from "./ai-elements/response";
import { Sources, SourcesTrigger, SourcesContent, Source, } from "./ai-elements/sources";
import { Reasoning, ReasoningTrigger, ReasoningContent, } from "./ai-elements/reasoning";
import { Loader } from "./ai-elements/loader";
import { Actions, Action } from "./ai-elements/actions";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Textarea } from "./ui/input";
import { ErrorBanner } from "./ai-elements/error-banner";
import { ArrowUp, Sparkles, Copy, ThumbsUp, ThumbsDown, RotateCw, Check, Bot, } from "lucide-react";
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
// ── Interrupt Dialog Component ──────────────────────────────────
function InterruptDialog({ interrupt, onApprove, onReject }) {
    // ALL hooks at top level — NEVER conditional (Rules of Hooks)
    const [selected, setSelected] = React.useState(0);
    const [formData, setFormData] = React.useState({});
    const input = interrupt.input || {};
    const isApproval = input.reason === "approval" || interrupt.toolName.includes("approve");
    const isChoice = input.reason === "choice" || !!input.options;
    const isInput = input.reason === "input" || !!input.schema;
    // ── Approval ──
    if (isApproval) {
        return (_jsxs(Card, { className: "mx-auto max-w-md rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-4 my-4", children: [_jsx("p", { className: "text-sm font-medium mb-1", children: input.title || "Approval required" }), _jsx("p", { className: "text-xs sm:text-sm text-muted-foreground mb-3", children: input.message || interrupt.toolName }), _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove({ approved: true }), children: "Continue" })] })] }));
    }
    // ── Choice ──
    if (isChoice) {
        return (_jsxs(Card, { className: "mx-auto max-w-md rounded-xl border p-4 my-4", children: [_jsx("p", { className: "text-sm font-medium mb-2", children: input.title || "Select an option" }), _jsx("div", { className: "flex flex-wrap gap-2 mb-3", children: (input.options || []).map((opt, i) => (_jsx(Button, { variant: selected === i ? "default" : "outline", size: "sm", onClick: () => setSelected(i), children: opt }, i))) }), _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove({ selected }), children: "Select" })] })] }));
    }
    // ── Input/form ──
    if (isInput) {
        return (_jsxs(Card, { className: "mx-auto max-w-md rounded-xl border p-4 my-4", children: [_jsx("p", { className: "text-sm font-medium mb-2", children: input.title || "Input required" }), input.schema?.properties && Object.keys(input.schema.properties).map((key) => (_jsxs("div", { className: "mb-2", children: [_jsx("label", { className: "text-[11px] text-muted-foreground", children: key }), _jsx(Textarea, { className: "min-h-[32px] text-xs", placeholder: input.schema.properties[key]?.description || key, value: formData[key] ?? "", onChange: (e) => setFormData(prev => ({ ...prev, [key]: e.target.value })) })] }, key))), _jsxs("div", { className: "flex gap-2 justify-end mt-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove(formData), children: "Submit" })] })] }));
    }
    // ── Generic fallback ──
    return (_jsxs(Card, { className: "mx-auto max-w-md rounded-xl border p-4 my-4", children: [_jsx("p", { className: "text-sm font-medium mb-1", children: "Agent needs input" }), _jsxs("p", { className: "text-xs text-muted-foreground mb-3", children: ["Tool: ", interrupt.toolName] }), _jsx("pre", { className: "text-[10px] bg-muted/50 rounded p-2 mb-3 overflow-x-auto max-h-32", children: JSON.stringify(input, null, 2) }), _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: onReject, children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => onApprove({}), children: "Continue" })] })] }));
}
export function AgentUI({ agent, className, placeholder = "Ask anything…", renderTool = {} }) {
    const [input, setInput] = React.useState("");
    const inputRef = React.useRef(null);
    // Auto-focus when idle
    React.useEffect(() => {
        if (!agent.isProcessing) {
            inputRef.current?.focus();
        }
    }, [agent.isProcessing]);
    // For each user message, show a reasoning block before the AI response
    const showReasoning = (msgIdx) => {
        const m = agent.messages[msgIdx];
        if (!m || m.role !== "assistant")
            return false;
        if (msgIdx < 1)
            return false;
        return agent.messages[msgIdx - 1]?.role === "user";
    };
    return (_jsxs("div", { className: cn("flex h-full flex-col bg-background text-foreground", className), children: [_jsx("div", { className: "flex-1 overflow-y-auto", children: _jsxs("div", { className: "mx-auto max-w-2xl lg:max-w-3xl px-3 sm:px-6 py-3 sm:py-8", children: [agent.messages.length === 0 && !agent.isProcessing && (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 py-12 text-center", children: [_jsx(Bot, { className: "h-8 w-8 text-muted-foreground" }), _jsx("h2", { className: "text-lg sm:text-xl font-semibold", children: "Agent ready" }), _jsx("p", { className: "text-sm text-muted-foreground max-w-md", children: "Type a message to start" })] })), agent.messages.map((msg, i) => (_jsxs(React.Fragment, { children: [showReasoning(i) && (_jsxs(Reasoning, { isStreaming: agent.isProcessing, defaultOpen: agent.isProcessing, children: [_jsx(ReasoningTrigger, { title: `Reasoning (${agent.state.planSteps.length} step${agent.state.planSteps.length === 1 ? "" : "s"})` }), _jsx(ReasoningContent, { children: _jsx("ol", { className: "space-y-1.5 list-decimal pl-4", children: agent.state.planSteps
                                                    .filter(s => s.status === "done")
                                                    .map((s, si) => (_jsxs("li", { className: "text-[11px] sm:text-xs", children: [_jsx("span", { className: "font-medium", children: s.intent }), s.detail && _jsxs("span", { className: "text-muted-foreground", children: [" \u2014 ", s.detail] })] }, si))) }) })] })), msg.role === "user" && (_jsxs(Message, { from: "user", children: [_jsx(MessageAvatar, { name: "You" }), _jsx(MessageContent, { children: msg.content })] })), msg.role === "tool" && msg.toolName && renderTool[msg.toolName] && (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsx(MessageContent, { children: renderTool[msg.toolName](msg) })] })), msg.role === "assistant" && (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsxs(MessageContent, { variant: "flat", children: [msg.content && (_jsxs("div", { className: "mt-1", children: [_jsx(Response, { children: msg.content }), agent.isProcessing && (_jsx("span", { className: "inline-block w-1.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-text-bottom" }))] })), !msg.content && agent.isProcessing && (_jsxs("div", { className: "flex items-center gap-2 text-muted-foreground text-xs", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: "Thinking\u2026" })] })), msg.sources && msg.sources.length > 0 && !agent.isProcessing && (_jsxs(Sources, { autoOpen: true, count: msg.sources.length, children: [_jsx(SourcesTrigger, { count: msg.sources.length }), _jsx(SourcesContent, { children: msg.sources.map((s) => (_jsx(Source, { href: s.url, title: s.title, domain: s.domain }, s.id))) })] })), msg.related && msg.related.length > 0 && !agent.isProcessing && (_jsx("div", { className: "mt-3 flex flex-wrap gap-1.5", children: msg.related.map((q, qi) => (_jsxs("button", { type: "button", className: "inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-[10px] sm:text-xs hover:border-foreground/30 hover:bg-accent/30 transition-colors", onClick: () => agent.send(q), children: [_jsx(Sparkles, { className: "h-2.5 w-2.5 text-muted-foreground" }), q] }, qi))) })), i === agent.messages.length - 1 && !agent.isProcessing && msg.content && (_jsxs(Actions, { children: [_jsx(CopyButton, { text: msg.content }), _jsx(Action, { tooltip: "Good answer", label: "Good answer", icon: ThumbsUp, onClick: () => { } }), _jsx(Action, { tooltip: "Bad answer", label: "Bad answer", icon: ThumbsDown, onClick: () => { } }), _jsx(Action, { tooltip: "Regenerate", label: "Regenerate", icon: RotateCw, onClick: () => { } })] }))] })] }))] }, msg.id))), agent.pendingInterrupt && (_jsx(InterruptDialog, { interrupt: agent.pendingInterrupt, onApprove: agent.approveInterrupt, onReject: () => agent.rejectInterrupt() })), agent.isProcessing && agent.messages.filter(m => m.role === "assistant").length === 0 && (_jsxs(Message, { from: "assistant", children: [_jsx(MessageAvatar, { name: "AI" }), _jsx(MessageContent, { variant: "flat", children: _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx(Loader, { size: 14 }), _jsx("span", { children: getActivityText(agent.state) || "Thinking…" })] }) })] })), agent.error && (_jsx("div", { className: "mt-3", children: _jsx(ErrorBanner, { error: {
                                    message: agent.error,
                                    severity: "error",
                                    retryable: true,
                                }, onRetry: () => {
                                    const lastUser = [...agent.messages]
                                        .reverse()
                                        .find((m) => m.role === "user");
                                    if (lastUser?.content)
                                        void agent.send(lastUser.content);
                                } }) }))] }) }), _jsx("div", { className: "border-t bg-background shrink-0", style: { paddingBottom: "env(safe-area-inset-bottom, 8px)" }, children: _jsx("div", { className: "p-2 sm:p-4", children: _jsxs("form", { onSubmit: (e) => { e.preventDefault(); if (input.trim()) {
                            agent.send(input);
                            setInput("");
                        } }, className: "mx-auto max-w-2xl lg:max-w-3xl", children: [_jsx(Card, { className: "rounded-xl sm:rounded-2xl shadow-sm border", children: _jsxs("div", { className: "flex items-end gap-1.5 sm:gap-2 p-2 sm:p-3", children: [_jsx(Textarea, { ref: inputRef, value: input, onChange: (e) => setInput(e.target.value), placeholder: placeholder, rows: 1, disabled: agent.isProcessing, enterKeyHint: "send", className: "flex-1 min-h-[22px] sm:min-h-[24px] max-h-36 sm:max-h-48 resize-none border-0 shadow-none focus:outline-none bg-transparent px-1 text-sm leading-5 sm:leading-6 py-[3px]", onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) {
                                                e.preventDefault();
                                                if (input.trim()) {
                                                    agent.send(input);
                                                    setInput("");
                                                }
                                            } } }), _jsx(Button, { type: "submit", size: "icon", disabled: !input.trim() || agent.isProcessing, className: "h-8 w-8 sm:h-9 sm:w-9 rounded-full shrink-0 active:scale-95 transition-transform", children: _jsx(ArrowUp, { className: "h-4 sm:h-[18px] w-4 sm:w-[18px]" }) })] }) }), _jsx("p", { className: "mt-1.5 text-center text-[9px] sm:text-[10px] text-muted-foreground", children: "Anvil agent \u2014 verify important info" })] }) }) })] }));
}
function CopyButton({ text }) {
    const [copied, setCopied] = React.useState(false);
    return (_jsx(Action, { tooltip: copied ? "Copied" : "Copy", label: "Copy", icon: copied ? Check : Copy, onClick: () => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } }));
}
//# sourceMappingURL=agent-ui.js.map