"use client";

/**
 * Loader — animated three-dot indicator for "assistant is thinking".
 *
 * Performance: dots are precomputed once per (size) change rather than
 * recreating the [0,1,2] array + 3 style objects on every render.
 */
import * as React from "react";
import { cn } from "../../lib/utils";

interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export const Loader = React.memo(function Loader({
  size = 16,
  className,
  ...props
}: LoaderProps) {
  const dotSize = Math.max(4, Math.floor(size / 4));
  // Memoize the dot definitions — they only change if dotSize changes.
  const dots = React.useMemo(
    () =>
      [0, 1, 2].map((i) => ({
        i,
        style: {
          width: dotSize,
          height: dotSize,
          animationDelay: `${i * 120}ms`,
          animationDuration: "800ms",
        },
      })),
    [dotSize],
  );

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("inline-flex items-center gap-1", className)}
      style={{ height: size }}
      {...props}
    >
      {dots.map((d) => (
        <span
          key={d.i}
          className="rounded-full bg-current animate-bounce"
          style={d.style}
        />
      ))}
    </div>
  );
});