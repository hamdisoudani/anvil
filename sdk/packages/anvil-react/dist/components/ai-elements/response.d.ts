/**
 * Response — renders AI assistant text as Markdown.
 *
 * Uses `marked` (CommonMark) + DOMPurify. DOMPurify is browser-only;
 * during SSR / first paint we render a safe plain-text fallback so
 * Next.js App Router never touches `window` on the server.
 */
import * as React from "react";
interface ResponseProps extends React.HTMLAttributes<HTMLDivElement> {
    children: string;
}
export declare function Response({ children, className, ...props }: ResponseProps): React.JSX.Element;
export {};
//# sourceMappingURL=response.d.ts.map