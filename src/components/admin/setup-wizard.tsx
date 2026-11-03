"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminRoutes, SETUP_STEP_LABELS, SETUP_STEPS, type SetupStep } from "@/lib/admin-routes";

export type WizardStepState = "done" | "current" | "open" | "locked" | "skipped";

const STATE_TEXT: Record<WizardStepState, string> = {
  done: "Done",
  skipped: "Skipped",
  locked: "Not yet",
  current: "You are here",
  open: "To do",
};

/**
 * Clickable wizard stepper. Done and open steps link to their URL; locked steps explain
 * themselves in a tooltip. `eventId` null = the create page (nothing exists yet).
 */
export function WizardStepper({
  eventId,
  current,
  states,
}: {
  eventId: number | null;
  current: SetupStep;
  states: Record<SetupStep, WizardStepState>;
}) {
  const index = SETUP_STEPS.indexOf(current);
  const stateOf = (s: SetupStep): WizardStepState => (s === current ? "current" : states[s]);
  const doneCount = SETUP_STEPS.filter((s) => stateOf(s) === "done").length;
  return (
    <nav aria-label="Setup steps" className="mb-6">
      {/* Mobile: "Step 3 of 6 · Warehouses" over a segmented progress bar (each segment links to its step). */}
      <div className="sm:hidden">
        <p className="flex items-baseline justify-between gap-3 text-xs text-slate-500">
          <span className="min-w-0 truncate">
            Step {index + 1} of {SETUP_STEPS.length} · <span className="font-medium text-slate-900">{SETUP_STEP_LABELS[current]}</span>
          </span>
          <span className="shrink-0 tabular-nums">{doneCount} done</span>
        </p>
        <ol className="mt-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${SETUP_STEPS.length}, minmax(0, 1fr))` }}>
          {SETUP_STEPS.map((s, i) => {
            const state = stateOf(s);
            const linkable = eventId !== null && state !== "locked" && state !== "current";
            const bar = (
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 rounded-full",
                  state === "current" && "bg-primary",
                  state === "done" && "bg-emerald-500",
                  (state === "open" || state === "skipped") && "bg-slate-300",
                  state === "locked" && "bg-slate-200"
                )}
              />
            );
            const label = `Step ${i + 1}: ${SETUP_STEP_LABELS[s]} (${STATE_TEXT[state].toLowerCase()})`;
            return (
              <li key={s}>
                {linkable ? (
                  <Link href={adminRoutes.setup(eventId!, s)} aria-label={label} className="block rounded-sm py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {bar}
                  </Link>
                ) : (
                  <div className="py-2" aria-current={state === "current" ? "step" : undefined}>
                    {bar}
                    <span className="sr-only">{label}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* sm+: labelled steps; scrolls sideways (without a visible scrollbar) if the row runs out of room. */}
      <ol className="scrollbar-none hidden gap-1 overflow-x-auto overflow-y-hidden pb-1 sm:flex">
        {SETUP_STEPS.map((s, i) => {
          const state = stateOf(s);
          const linkable = eventId !== null && state !== "locked" && state !== "current";
          const marker = (
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                state === "current" && "bg-primary text-primary-foreground",
                state === "done" && "bg-emerald-600 text-white",
                state === "open" && "border border-slate-300 text-slate-600",
                state === "skipped" && "border border-dashed border-slate-300 text-slate-400",
                state === "locked" && "bg-slate-100 text-slate-400"
              )}
            >
              {state === "done" ? <Check className="h-3 w-3" /> : state === "locked" ? <Lock className="h-2.5 w-2.5" /> : i + 1}
            </span>
          );
          const label = (
            <span className="min-w-0">
              <span className="block truncate">{SETUP_STEP_LABELS[s]}</span>
              <span className="block text-[11px] font-normal text-slate-400">
                {STATE_TEXT[state]}
              </span>
            </span>
          );
          const cls = cn(
            "flex min-w-[7rem] items-center gap-2 border-t-2 pt-2 text-xs transition-colors",
            state === "current" ? "border-primary font-medium text-slate-900" : state === "done" ? "border-emerald-500/60 text-slate-700" : "border-slate-200 text-slate-500"
          );
          return (
            <li key={s} className="flex-1">
              {linkable ? (
                <Link
                  href={adminRoutes.setup(eventId!, s)}
                  className={cn(cls, "rounded-sm hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {marker}
                  {label}
                </Link>
              ) : (
                <div
                  className={cls}
                  aria-current={state === "current" ? "step" : undefined}
                  title={state === "locked" ? "Finish the earlier steps first" : undefined}
                >
                  {marker}
                  {label}
                  {state === "locked" && <span className="sr-only">(locked: finish the earlier steps first)</span>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Back / Save & exit / Continue bar under a wizard step. */
export function WizardFooter({
  back,
  exitHref,
  next,
}: {
  back?: React.ReactNode;
  exitHref: string;
  /** The primary action (Continue / Go live) and its blocked reason, if any. */
  next?: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <Link
          href={exitHref}
          className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Save &amp; exit
        </Link>
      </div>
      {next}
    </div>
  );
}
