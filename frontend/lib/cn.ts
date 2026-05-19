import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine class names with conditional logic and Tailwind merging.
 *
 * Example:
 *   cn("p-4", isActive && "bg-brand-50", "text-ink")
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
