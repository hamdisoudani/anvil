"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Response — renders AI assistant text with markdown.
 *
 * For production, use streamdown (https://streamdown.ai/) which handles
 * streaming markdown safely (avoids XSS, handles partial blocks).
 * This minimal version renders basic markdown: **bold**, *italic*,
 * `code`, headings, lists, links, and newlines.
 */
import * as React from "react";
import { cn } from "../../lib/utils";
// Lightweight streaming-safe markdown renderer.
// Handles: **bold**, *italic*, `inline`, # heading, - list, links, paragraphs.
function renderMarkdown(text) {
    if (!text)
        return [];
    const blocks = text.split(/\n\n+/);
    return blocks.map((block, bi) => {
        const lines = block.split("\n");
        // Headings
        if (block.startsWith("# "))
            return _jsx("h1", { className: "text-lg sm:text-xl font-semibold mt-3 mb-1.5", children: renderInline(block.slice(2)) }, bi);
        if (block.startsWith("## "))
            return _jsx("h2", { className: "text-base sm:text-lg font-semibold mt-3 mb-1.5", children: renderInline(block.slice(3)) }, bi);
        if (block.startsWith("### "))
            return _jsx("h3", { className: "text-sm sm:text-base font-semibold mt-2 mb-1", children: renderInline(block.slice(4)) }, bi);
        // Unordered list
        if (lines.every((l) => l.startsWith("- ") || l.trim() === "")) {
            return (_jsx("ul", { className: "list-disc pl-5 my-2 space-y-0.5", children: lines.filter((l) => l.trim()).map((l, i) => (_jsx("li", { children: renderInline(l.slice(2)) }, i))) }, bi));
        }
        // Numbered list
        if (lines.every((l) => /^\d+\.\s/.test(l) || l.trim() === "")) {
            return (_jsx("ol", { className: "list-decimal pl-5 my-2 space-y-0.5", children: lines.filter((l) => l.trim()).map((l, i) => (_jsx("li", { children: renderInline(l.replace(/^\d+\.\s/, "")) }, i))) }, bi));
        }
        // Code block
        if (block.startsWith("```")) {
            const code = block.replace(/^```\w*\n?/, "").replace(/```$/, "");
            return (_jsx("pre", { className: "bg-muted/70 rounded-md p-2.5 my-2 overflow-x-auto text-[11px] sm:text-xs", children: _jsx("code", { children: code }) }, bi));
        }
        // Default: paragraph (preserve single newlines as <br/>)
        return (_jsx("p", { className: "my-1.5 last:mb-0 first:mt-0", children: lines.map((line, li) => (_jsxs(React.Fragment, { children: [li > 0 && _jsx("br", {}), renderInline(line)] }, li))) }, bi));
    });
}
function renderInline(text) {
    // Order: code > bold > italic > links
    const parts = [];
    const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let m;
    let key = 0;
    while ((m = regex.exec(text)) !== null) {
        if (m.index > last)
            parts.push(text.slice(last, m.index));
        if (m[1])
            parts.push(_jsx("code", { className: "bg-muted/70 rounded px-1 py-0.5 text-[0.9em] font-mono", children: m[1].slice(1, -1) }, key++));
        else if (m[2])
            parts.push(_jsx("strong", { children: m[2].slice(2, -2) }, key++));
        else if (m[3])
            parts.push(_jsx("em", { children: m[3].slice(1, -1) }, key++));
        else if (m[4]) {
            const lm = m[4].match(/\[([^\]]+)\]\(([^)]+)\)/);
            parts.push(_jsx("a", { href: lm[2], target: "_blank", rel: "noopener noreferrer", className: "text-primary underline underline-offset-2 hover:text-primary/80", children: lm[1] }, key++));
        }
        last = m.index + m[0].length;
    }
    if (last < text.length)
        parts.push(text.slice(last));
    return _jsx(_Fragment, { children: parts });
}
export function Response({ children, className, ...props }) {
    return (_jsx("div", { className: cn("prose prose-sm dark:prose-invert max-w-none break-words", className), ...props, children: renderMarkdown(children) }));
}
//# sourceMappingURL=response.js.map