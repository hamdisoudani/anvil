"use client";

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

interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
  children: string;
}

// Lightweight streaming-safe markdown renderer.
// Handles: **bold**, *italic*, `inline`, # heading, - list, links, paragraphs.
function renderMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];
  const blocks = text.split(/\n\n+/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n");
    // Headings
    if (block.startsWith("# ")) return <h1 key={bi} className="text-lg sm:text-xl font-semibold mt-3 mb-1.5">{renderInline(block.slice(2))}</h1>;
    if (block.startsWith("## ")) return <h2 key={bi} className="text-base sm:text-lg font-semibold mt-3 mb-1.5">{renderInline(block.slice(3))}</h2>;
    if (block.startsWith("### ")) return <h3 key={bi} className="text-sm sm:text-base font-semibold mt-2 mb-1">{renderInline(block.slice(4))}</h3>;
    // Unordered list
    if (lines.every((l) => l.startsWith("- ") || l.trim() === "")) {
      return (
        <ul key={bi} className="list-disc pl-5 my-2 space-y-0.5">
          {lines.filter((l) => l.trim()).map((l, i) => (
            <li key={i}>{renderInline(l.slice(2))}</li>
          ))}
        </ul>
      );
    }
    // Numbered list
    if (lines.every((l) => /^\d+\.\s/.test(l) || l.trim() === "")) {
      return (
        <ol key={bi} className="list-decimal pl-5 my-2 space-y-0.5">
          {lines.filter((l) => l.trim()).map((l, i) => (
            <li key={i}>{renderInline(l.replace(/^\d+\.\s/, ""))}</li>
          ))}
        </ol>
      );
    }
    // Code block
    if (block.startsWith("```")) {
      const code = block.replace(/^```\w*\n?/, "").replace(/```$/, "");
      return (
        <pre key={bi} className="bg-muted/70 rounded-md p-2.5 my-2 overflow-x-auto text-[11px] sm:text-xs">
          <code>{code}</code>
        </pre>
      );
    }
    // Default: paragraph (preserve single newlines as <br/>)
    return (
      <p key={bi} className="my-1.5 last:mb-0 first:mt-0">
        {lines.map((line, li) => (
          <React.Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(line)}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

function renderInline(text: string): React.ReactNode {
  // Order: code > bold > italic > links
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<code key={key++} className="bg-muted/70 rounded px-1 py-0.5 text-[0.9em] font-mono">{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={key++}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) parts.push(<em key={key++}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) {
      const lm = m[4].match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      parts.push(<a key={key++} href={lm[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{lm[1]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function Response({ children, className, ...props }: ResponseProps) {
  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none break-words", className)}
      {...props}
    >
      {renderMarkdown(children)}
    </div>
  );
}
