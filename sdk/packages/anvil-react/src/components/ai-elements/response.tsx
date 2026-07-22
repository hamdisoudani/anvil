"use client";

/**
 * Response — renders AI assistant text as Markdown.
 *
 * Uses `marked` (CommonMark) + DOMPurify. DOMPurify is browser-only;
 * during SSR / first paint we render a safe plain-text fallback so
 * Next.js App Router never touches `window` on the server.
 */
import * as React from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
  children: string;
}

marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
});

function renderMarkdown(text: string): string {
  if (!text) return "";
  // DOMPurify needs a DOM — skip sanitize on the server.
  if (typeof window === "undefined") {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
  }
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    ALLOW_DATA_ATTR: false,
  });
}

export function Response({ children, className, ...props }: ResponseProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const html = React.useMemo(
    () => renderMarkdown(children),
    // re-run after mount so we switch from plain-text SSR fallback to
    // fully sanitized markdown once DOMPurify is available
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [children, mounted],
  );

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
