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
export declare function Response({ children, sources, renderer, className, ...props }: ResponseProps): React.JSX.Element;
export {};
//# sourceMappingURL=response.d.ts.map