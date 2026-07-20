"use client";

/**
 * Loader — animated three-dot indicator for "assistant is thinking".
 */
import * as React from "react";
import { cn } from "../../lib/utils";

interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export function Loader({ size = 16, className, ...props }: LoaderProps) {
  const dotSize = Math.max(4, Math.floor(size / 4));
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("inline-flex items-center gap-1", className)}
      style={{ height: size }}
      {...props}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rounded-full bg-current animate-bounce"
          style={{
            width: dotSize,
            height: dotSize,
            animationDelay: `${i * 120}ms`,
            animationDuration: "800ms",
          }}
        />
      ))}
    </div>
  );
}
