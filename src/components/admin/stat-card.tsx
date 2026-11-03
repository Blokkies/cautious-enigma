import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "positive" | "negative" | "warning";

const TONE: Record<StatTone, string> = {
  default: "text-slate-900",
  positive: "text-emerald-700",
  negative: "text-red-700",
  warning: "text-amber-700",
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Small line under the value, e.g. "of 1 240 items". */
  hint?: React.ReactNode;
  icon?: LucideIcon;
  /** Colours the value: positive (green), negative (red), warning (amber). */
  tone?: StatTone;
  /** Makes the whole card a link. */
  href?: string;
  className?: string;
}

/** One metric tile. Lay several out in a grid, e.g. "grid grid-cols-2 gap-3 lg:grid-cols-4". */
export function StatCard({ label, value, hint, icon: Icon, tone = "default", href, className }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", TONE[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </>
  );
  const base = cn("block rounded-lg border border-slate-200 bg-white p-4", className);
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          "transition-colors hover:border-slate-300 hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}
