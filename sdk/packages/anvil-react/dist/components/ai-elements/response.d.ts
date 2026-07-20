/**
 * Response — renders AI assistant text with markdown.
 *
 * For production, use streamdown (https://streamdown.ai/) which handles
 * streaming markdown safely (avoids XSS, handles partial blocks).
 * This minimal version renders basic markdown: **bold**, *italic*,
 * `code`, headings, lists, links, and newlines.
 */
import * as React from "react";
interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
    children: string;
}
export declare function Response({ children, className, ...props }: ResponseProps): React.JSX.Element;
export {};
//# sourceMappingURL=response.d.ts.map