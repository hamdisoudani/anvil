/**
 * Reasoning — collapsible agent thinking display.
 *
 * Behavior matches AI Elements: opens by default when streaming,
 * auto-collapses when isStreaming becomes false.
 */
import * as React from "react";
interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
    isStreaming?: boolean;
    defaultOpen?: boolean;
}
export declare function Reasoning({ isStreaming, defaultOpen, className, children, ...props }: ReasoningProps): React.JSX.Element;
interface ReasoningTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    title?: string;
}
export declare function ReasoningTrigger({ title, className, ...props }: ReasoningTriggerProps): React.JSX.Element;
interface ReasoningContentProps extends React.HTMLAttributes<HTMLDivElement> {
}
export declare function ReasoningContent({ className, children, ...props }: ReasoningContentProps): React.JSX.Element | null;
export {};
//# sourceMappingURL=reasoning.d.ts.map