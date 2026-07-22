/**
 * Reasoning — collapsible agent thinking display.
 *
 * Behavior matches AI Elements: opens by default when streaming,
 * auto-collapses when isStreaming becomes false.
 *
 * Performance notes:
 *  - Auto-open / auto-collapse is derived from props (no mirror state
 *    and no effect) — eliminates an extra commit on every streaming flip.
 *  - Context value is memoized so consumers don't re-render unless
 *    `open` actually changes (clicking the trigger vs parent rerender).
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
export declare const ReasoningContent: React.NamedExoticComponent<ReasoningContentProps>;
export {};
//# sourceMappingURL=reasoning.d.ts.map