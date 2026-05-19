import { cn } from "@/lib/cn";

/**
 * Pulsing grey block. Compose into shapes that approximate the
 * eventual content so the page doesn't visibly snap between empty
 * and full when data arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-surface-line/70",
        className
      )}
    />
  );
}
