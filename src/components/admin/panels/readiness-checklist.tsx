"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminRoutes, type SetupStep } from "@/lib/admin-routes";
import { ListSkeleton } from "../loading-state";
import { ErrorState } from "../error-state";
import type { FetchState, Readiness } from "./use-event-data";
import { readinessLines } from "./readiness-lines";

const STEP_TAB = { items: "items", people: "people", bins: "bins" } as const;

/**
 * Go-live checklist. Each open line links to where it is fixed: the wizard step
 * (`linkTo="wizard"`) or the workspace tab (default).
 */
export function ReadinessChecklist({
  eventId,
  state,
  linkTo = "workspace",
  className,
}: {
  eventId: number;
  state: FetchState<Readiness>;
  linkTo?: "workspace" | "wizard";
  className?: string;
}) {
  if (state.loading) return <ListSkeleton rows={4} />;
  if (state.error && !state.data) {
    return <ErrorState title="Could not check readiness" message={state.error} onRetry={() => void state.reload()} />;
  }
  const r = state.data!;
  const lines = readinessLines(r);
  const doneCount = lines.filter((l) => l.ok).length;
  const href = (step: SetupStep) =>
    linkTo === "wizard" ? adminRoutes.setup(eventId, step) : adminRoutes.event(eventId, STEP_TAB[step as keyof typeof STEP_TAB] ?? "overview");

  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white", className)} aria-labelledby={`readiness-${eventId}`}>
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <h3 id={`readiness-${eventId}`} className="text-base font-semibold text-slate-900">
          Ready to go live?
        </h3>
        <span className="text-xs tabular-nums text-slate-500">
          {doneCount} of {lines.length} done
        </span>
      </header>
      <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
        {lines.map((l) => {
          const body = (
            <>
              {l.ok ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", l.ok ? "text-slate-700" : "text-slate-900")}>
                  {l.label}
                  <span className="sr-only">{l.ok ? " (done)" : " (to do)"}</span>
                </span>
                <span className="block text-xs text-slate-500">{l.detail}</span>
              </span>
            </>
          );
          return (
            <li key={l.key}>
              {l.ok ? (
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
              ) : (
                <Link
                  href={href(l.step)}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                >
                  {body}
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                    Fix
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {r.blocker && (
        <p className="flex items-start gap-2 border-t border-slate-100 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 sm:px-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {r.blocker}
        </p>
      )}
    </section>
  );
}
