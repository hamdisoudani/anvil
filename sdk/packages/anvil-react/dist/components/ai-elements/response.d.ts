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
interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
    children: string;
}
export declare function Response({ children, className, ...props }: ResponseProps): React.JSX.Element;
export {};
//# sourceMappingURL=response.d.ts.map