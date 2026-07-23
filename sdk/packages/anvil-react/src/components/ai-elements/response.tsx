"use client";

/**
 * Response — renders AI assistant text as Markdown, with optional
 * citation-aware linking.
 *
 * Uses `marked` (CommonMark) + DOMPurify. DOMPurify is browser-only;
 * during SSR / first paint we render a safe plain-text fallback so
 * Next.js App Router never touches `window` on the server.
 *
 * CITATION MODE: pass `sources` to auto-link `[1]`, `[2]`, ... in the
 * answer text to the corresponding sources. The pattern matches
 * bracketed integers; non-matching brackets are left untouched.
 *
 * ESCAPE HATCH: pass `renderer` for full control over the final HTML
 * (after citations are linked).
 */
import * as React from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "../../lib/utils";

export interface ResponseSource {
  id: number;
  url: string;
  title: string;
  domain: string;
}

interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
  children: string;
  /**
   * Sources to link citations to. When provided, `[1]`, `[2]`, ... in
   * the answer text become clickable links pointing to the source URL.
   * Sources are matched by their `id` field.
   */
  sources?: ResponseSource[];
  /**
   * Override the final HTML after markdown + citation linking.
   * Useful for adding custom syntax highlighting, math, etc.
   */
  renderer?: (html: string) => string;
}

marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
});

/**
 * Replace `[N]` citation markers in the text with anchor links to the
 * matching source. Only matches bracketed integers (1+ digits).
 */
function linkCitations(text: string, sources: ResponseSource[]): string {
  if (!sources || sources.length === 0) return text;
  const byId = new Map(sources.map((s) => [s.id, s]));
  return text.replace(/\[(\d+)\]/g, (match, n) => {
    const id = Number(n);
    const src = byId.get(id);
    if (!src) return match;
    return `<a href="${escapeAttr(src.url)}" target="_blank" rel="noopener noreferrer" data-citation="${id}" class="anvil-citation anvil-citation-link">[${id}]</a>`;
  });
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(
  text: string,
  sources: ResponseSource[] | undefined,
  renderer: ((html: string) => string) | undefined,
): string {
  if (!text) return "";
  // Link citations BEFORE markdown so the [N] tokens survive.
  const linked = sources ? linkCitations(text, sources) : text;
  // DOMPurify needs a DOM — skip sanitize on the server.
  let html: string;
  if (typeof window === "undefined") {
    html = linked
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
  } else {
    const raw = marked.parse(linked, { async: false }) as string;
    html = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
      ALLOW_DATA_ATTR: false,
    });
  }
  // Allow consumer to transform the final HTML.
  if (renderer) html = renderer(html);
  return html;
}

export function Response({
  children,
  sources,
  renderer,
  className,
  ...props
}: ResponseProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const html = React.useMemo(
    () => renderMarkdown(children, sources, renderer),
    // re-run after mount so we switch from plain-text SSR fallback to
    // fully sanitized markdown once DOMPurify is available
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [children, sources, renderer, mounted],
  );

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_.anvil-citation-link]:inline-flex [&_.anvil-citation-link]:items-center [&_.anvil-citation-link]:justify-center [&_.anvil-citation-link]:min-w-[1.4em] [&_.anvil-citation-link]:h-[1.4em] [&_.anvil-citation-link]:px-1 [&_.anvil-citation-link]:mx-0.5 [&_.anvil-citation-link]:text-[0.75em] [&_.anvil-citation-link]:font-semibold [&_.anvil-citation-link]:no-underline [&_.anvil-citation-link]:align-baseline [&_.anvil-citation-link]:rounded [&_.anvil-citation-link]:bg-primary/10 [&_.anvil-citation-link]:text-primary hover:[&_.anvil-citation-link]:bg-primary/20",
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
