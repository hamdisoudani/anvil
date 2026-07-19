// Utility for shadcn-style class merging.
// Combines clsx (conditional classes) + tailwind-merge (deduplicates).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
