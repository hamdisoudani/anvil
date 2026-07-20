// Utility for shadcn-style class merging.
// Combines clsx (conditional classes) + tailwind-merge (deduplicates).
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
//# sourceMappingURL=utils.js.map