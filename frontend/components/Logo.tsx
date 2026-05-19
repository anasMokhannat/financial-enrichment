import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * Brand mark. Renders the SVG shipped under public/logo-flugia.svg.
 * Height is fixed; width auto-scales via aspect ratio so the file's
 * intrinsic proportions are preserved.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-flugia.svg"
      alt="Flugia"
      width={120}
      height={28}
      priority
      className={cn("h-7 w-auto", className)}
    />
  );
}
