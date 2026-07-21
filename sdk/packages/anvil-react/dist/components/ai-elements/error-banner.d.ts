export interface AgentErrorLike {
    message: string;
    code?: string;
    severity?: "info" | "warning" | "error" | "fatal";
    recoverable?: boolean;
    retryable?: boolean;
    stepId?: string;
    raw?: unknown;
}
export interface ErrorBannerProps {
    /** The error — either a structured AgentError object or a plain string. */
    error: AgentErrorLike | string;
    /** Called when the user wants to retry (only shown when retryable). */
    onRetry?: () => void;
    /** Called when the user dismisses the banner. */
    onDismiss?: () => void;
    /** Optional CSS class override. */
    className?: string;
}
export declare function ErrorBanner({ error, onRetry, onDismiss, className, }: ErrorBannerProps): import("react").JSX.Element;
//# sourceMappingURL=error-banner.d.ts.map