import { cn } from "@/lib/utils";
import { statusMeta } from "./status";

export interface StatusBadgeProps {
  status: string | null | undefined;
  size?: "sm" | "md";
  /** Show what the status means as a native tooltip (default true). */
  showDescription?: boolean;
  className?: string;
}

/** Event status pill using the shared colour scheme (see statusMeta in ./status). */
export function StatusBadge({ status, size = "md", showDescription = true, className }: StatusBadgeProps) {
  const meta = statusMeta(status);
  return (
    <span
      title={showDescription ? meta.description : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs",
        meta.badgeClass,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
