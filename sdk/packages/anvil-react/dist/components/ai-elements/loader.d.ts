/**
 * Loader — animated three-dot indicator for "assistant is thinking".
 *
 * Performance: dots are precomputed once per (size) change rather than
 * recreating the [0,1,2] array + 3 style objects on every render.
 */
import * as React from "react";
interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
    size?: number;
}
export declare const Loader: React.NamedExoticComponent<LoaderProps>;
export {};
//# sourceMappingURL=loader.d.ts.map