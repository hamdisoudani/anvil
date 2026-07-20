"use client";
import { jsx as _jsx } from "react/jsx-runtime";
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
import { cn } from "../../lib/utils";
// Configure marked for safe, streaming-friendly rendering.
marked.setOptions({
    gfm: true,
    breaks: true,
    pedantic: false,
});
/**
 * Render markdown to safe HTML.
 *
 * - Replaces `javascript:` URLs in links
 * - Strips raw <script>/<style> blocks (defense in depth)
 * - Strips most HTML attributes except `href`, `target`, `rel`, `class`
 */
function renderMarkdown(text) {
    if (!text)
        return "";
    const raw = marked.parse(text, { async: false });
    return sanitize(raw);
}
const ALLOWED_TAGS = new Set([
    "p", "br", "hr",
    "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "sub", "sup",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "blockquote",
    "code", "pre", "kbd", "samp",
    "a",
    "table", "thead", "tbody", "tr", "th", "td",
    "img",
    "span", "div",
]);
const ALLOWED_ATTRS = new Set(["href", "target", "rel", "class", "title", "alt", "src"]);
// Minimal HTML sanitizer — strips tags not in the allowlist and
// any on* event handlers. Not a full DOMPurify replacement, but
// sufficient for the AI-generated content we render.
function sanitize(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_, slash, tag, attrs) => {
        const lower = tag.toLowerCase();
        if (!ALLOWED_TAGS.has(lower))
            return "";
        if (slash)
            return `</${lower}>`;
        const cleanAttrs = attrs.replace(/([a-zA-Z\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (m, name, v1, v2) => {
            const n = name.toLowerCase();
            if (!ALLOWED_ATTRS.has(n))
                return "";
            const v = (v1 ?? v2 ?? "").replace(/"/g, "&quot;");
            return `${n}="${v}"`;
        });
        return `<${lower}${cleanAttrs}>`;
    });
}
export function Response({ children, className, ...props }) {
    const html = React.useMemo(() => renderMarkdown(children), [children]);
    return (_jsx("div", { className: cn("prose prose-sm dark:prose-invert max-w-none break-words", "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2", "[&_code]:bg-muted/70 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_code]:font-mono", "[&_pre]:bg-muted/70 [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:my-2 [&_pre]:overflow-x-auto", "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2", "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2", "[&_li]:my-0.5", "[&_h1]:text-lg [&_h1]:sm:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5", "[&_h2]:text-base [&_h2]:sm:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5", "[&_h3]:text-sm [&_h3]:sm:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1", "[&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:italic", className), dangerouslySetInnerHTML: { __html: html }, ...props }));
}
//# sourceMappingURL=response.js.map