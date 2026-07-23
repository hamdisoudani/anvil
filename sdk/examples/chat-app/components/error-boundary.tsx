"use client";

/**
 * Production error boundary for the chat-app.
 *
 * In Next.js 16 + React 19, render-time exceptions in client components
 * are SWALLOWED in production builds (no error overlay, no console.error
 * leak). Without an explicit error boundary, a single thrown render
 * freezes the UI in its last-good state — which is exactly the
 * "Send button permanently disabled, typing doesn't update React state"
 * symptom we hit when bisecting the canonicalization regression.
 *
 * This boundary catches render exceptions and surfaces them in the
 * DOM so they're visible in browser screenshots and DevTools without
 * needing source-map access.
 */
import * as React from "react";

interface ErrorBoundaryState {
  error: Error | null;
  info: string | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ChatErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Always log so the error is grep-able in production logs.
    console.error("[ChatErrorBoundary]", error, info);
    this.setState({ error, info: info.componentStack ?? null });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            padding: "1.5rem",
            margin: "1.5rem",
            borderRadius: "0.75rem",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.4)",
            color: "rgb(254, 226, 226)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "70vh",
            overflow: "auto",
          }}
        >
          <strong style={{ display: "block", marginBottom: "0.5rem", fontSize: "1rem" }}>
            ⚠ Render exception — the chat UI crashed
          </strong>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>message:</strong> {this.state.error.message || "(empty)"}
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>stack:</strong>
            {"\n"}
            {(this.state.error.stack ?? "(no stack)").slice(0, 1500)}
          </div>
          {this.state.info && (
            <div>
              <strong>component stack:</strong>
              {"\n"}
              {this.state.info.slice(0, 800)}
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}