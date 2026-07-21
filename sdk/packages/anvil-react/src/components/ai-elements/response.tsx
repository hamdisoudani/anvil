"use client";

/**
 * Response — renders AI assistant text as Markdown.
 *
 * Uses `marked` (battle-tested CommonMark parser) instead of a homegrown
 * regex parser. Renders HTML, sanitized via a strict allowlist.
 *
 * The AI SDK ecosystem recommends `streamdown` for production, but it
 * pulls in additional deps and assumes the AI SDK. `marked` is
 * dependency-light and handles nested bold/italic/code correctly.
 */
import * as React from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
  children: string;
}

// Configure marked for safe, streaming-friendly rendering.
marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
});

/**
 * Render markdown to safe HTML via marked + DOMPurify.
 */
function renderMarkdown(text: string): string {
  if (!text) return "";
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    ALLOW_DATA_ATTR: false,
  });
}

export function Response({ children, className, ...props }: ResponseProps) {
  const html = React.useMemo(() => renderMarkdown(children), [children]);
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_code]:bg-muted/70 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_code]:font-mono",
        "[&_pre]:bg-muted/70 [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:my-2 [&_pre]:overflow-x-auto",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2",
        "[&_li]:my-0.5",
        "[&_h1]:text-lg [&_h1]:sm:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5",
        "[&_h2]:text-base [&_h2]:sm:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5",
        "[&_h3]:text-sm [&_h3]:sm:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:italic",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  );
}
