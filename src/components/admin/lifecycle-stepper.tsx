import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_STATUSES } from "@/lib/event-status";
import { statusMeta } from "./status";

/** What moves an event into each stage (shown under the stage). */
const ENTERED_BY: Record<string, string> = {
  setup: "Created",
  active: "Go live",
  completed: "Mark complete",
  locked: "Lock",
};

/**
 * Setup → Live → Completed → Locked, with the current stage highlighted and what each stage
 * means. Horizontal on wide screens, a vertical list on phones.
 */
export function LifecycleStepper({ status }: { status: string }) {
  const current = statusMeta(status).order;
  return (
    <ol className="grid gap-0 rounded-lg border border-slate-200 bg-white md:grid-cols-4" aria-label="Stocktake lifecycle">
      {EVENT_STATUSES.map((s, i) => {
        const meta = statusMeta(s);
        const isCurrent = i === current;
        const isDone = i < current;
        return (
          <li
            key={s}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "relative flex gap-3 p-4 md:flex-col md:gap-2",
              i > 0 && "border-t border-slate-100 md:border-l md:border-t-0",
              isCurrent && "bg-slate-50/80"
            )}
          >
            {isCurrent && <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 hidden h-0.5 md:block", meta.dotClass)} />}
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  isDone && "bg-slate-900 text-white",
                  isCurrent && cn(meta.dotClass, "text-white ring-4 ring-offset-0", ringFor(s)),
                  !isDone && !isCurrent && "border border-slate-300 text-slate-400"
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("text-sm font-semibold", isCurrent ? "text-slate-900" : isDone ? "text-slate-700" : "text-slate-400")}>
                {meta.label}
              </span>
              {isCurrent && <span className="text-xs text-slate-500 md:hidden">(now)</span>}
            </div>
            <div className="min-w-0 space-y-1">
              <p className={cn("text-xs leading-relaxed", isCurrent ? "text-slate-600" : "text-slate-500")}>{meta.description}</p>
              {i > 0 && (
                <p className="text-[11px] text-slate-400">
                  Reached with <span className="font-medium text-slate-500">{ENTERED_BY[s]}</span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ringFor(status: string): string {
  switch (status) {
    case "setup":
      return "ring-blue-100";
    case "active":
      return "ring-emerald-100";
    case "completed":
      return "ring-indigo-100";
    default:
      return "ring-slate-200";
  }
}
