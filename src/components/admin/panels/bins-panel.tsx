"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Scale, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatNumber, plural } from "@/lib/format";
import { adminRoutes } from "@/lib/admin-routes";
import { useAssignment, useAssignedBinFilters } from "@/components/teams/use-assignment";
import { TeamAssignmentsCard, UnassignedBinsCard } from "@/components/teams/assign-cards";
import { ReassignDialog, useReassign } from "@/components/teams/reassign-dialog";
import type { BalanceMode } from "@/components/teams/assign-types";
import { useAdminEvent } from "../event-context";
import { useConfirm } from "../confirm-dialog";
import { PageSkeleton } from "../loading-state";
import { EmptyState } from "../empty-state";
import { ReadOnlyNotice } from "./panel-section";

const MODES: { value: BalanceMode; label: string; hint: string }[] = [
  { value: "equal-bins", label: "Same number of bins", hint: "Best when bins are similar in size." },
  { value: "equal-items", label: "Same number of items", hint: "Best when some bins hold far more items than others." },
];

/**
 * Bin assignment for the current event: one-click auto-balance across all teams, then the
 * full manual tools (per-team filters, counted badges, re-assign, bulk removal).
 * `peopleHref` is where "add a team" links to (workspace tab or wizard step).
 */
export function BinsPanel({ onChanged, peopleHref }: { onChanged?: () => void; peopleHref?: string }) {
  const { event, reload: reloadEvent } = useAdminEvent();
  const eventId = event!.id;
  const closed = event!.status === "completed" || event!.status === "locked";
  const assign = useAssignment(String(eventId));
  const reassign = useReassign(assign);
  const filters = useAssignedBinFilters();
  const [confirm, confirmDialog] = useConfirm();
  const [mode, setMode] = useState<BalanceMode>("equal-bins");

  // Tell the workspace/wizard when the assignment changes (any action reloads `stats`).
  const lastStats = useRef<string | null>(null);
  const { stats } = assign;
  useEffect(() => {
    if (assign.loading) return;
    const key = `${stats.total}/${stats.assigned}`;
    if (lastStats.current !== null && lastStats.current !== key) {
      void reloadEvent();
      onChanged?.();
    }
    lastStats.current = key;
  }, [assign.loading, stats.total, stats.assigned, reloadEvent, onChanged]);

  if (assign.loading) return <PageSkeleton />;

  const teamCount = assign.teamDetails.length;
  const unassigned = stats.unassigned;
  const allDone = stats.total > 0 && unassigned === 0;
  const percent = assign.assignedPercent;

  const balanceAll = async () => {
    const ok = await confirm({
      title: "Auto-balance all unassigned bins?",
      description: (
        <>
          <p>
            Every unassigned bin ({plural(unassigned, "item")}) is shared across all{" "}
            {plural(teamCount, "team")} in bin order, so neighbouring bins stay with the same team.
            Bins that are already assigned are not moved.
          </p>
          <p>You can adjust the result by hand afterwards.</p>
        </>
      ),
      confirmLabel: "Auto-balance",
    });
    if (ok) await assign.handleAutoBalanceAll(mode);
  };

  if (stats.total === 0) {
    return (
      <EmptyState
        title="No items to assign yet"
        description="Bins come from the stock file. Import it first, then assign bins to teams here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {closed && (
        <ReadOnlyNotice>Counting has finished, so assignments are shown for reference only.</ReadOnlyNotice>
      )}

      {/* Summary + one-click balance */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-baseline gap-2">
              {allDone ? (
                <span className="inline-flex items-center gap-1.5 text-base font-semibold text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                  Every item is assigned
                </span>
              ) : (
                <>
                  <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{formatNumber(unassigned)}</span>
                  <span className="text-sm text-slate-600">item{unassigned === 1 ? "" : "s"} still unassigned</span>
                </>
              )}
            </div>
            <Progress value={percent} className="h-2" aria-label={`${percent}% assigned`} />
            <p className="text-xs tabular-nums text-slate-500">
              {formatNumber(stats.assigned)} of {formatNumber(stats.total)} items assigned ({percent}%) across {plural(teamCount, "team")}
            </p>
          </div>
        </div>

        {!closed && !allDone && (
          <div className="border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5">
            {teamCount === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  Add at least one counting team before assigning bins.
                </p>
                <Button asChild size="sm">
                  <Link href={peopleHref ?? adminRoutes.event(eventId, "people")}>Add teams</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Recommended: auto-balance</h3>
                  <p className="text-sm text-slate-600">
                    Share all unassigned bins across all {plural(teamCount, "team")} in one click. Choose how to even them out:
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div role="radiogroup" aria-label="Balance by" className="grid flex-1 gap-2 sm:grid-cols-2">
                    {MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={mode === m.value}
                        onClick={() => setMode(m.value)}
                        className={cn(
                          "rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          mode === m.value ? "border-primary bg-white ring-1 ring-primary" : "border-slate-200 bg-white hover:border-slate-300"
                        )}
                      >
                        <span className="block text-sm font-medium text-slate-900">{m.label}</span>
                        <span className="block text-xs text-slate-500">{m.hint}</span>
                      </button>
                    ))}
                  </div>
                  <Button size="lg" onClick={() => void balanceAll()} disabled={assign.balancing} className="lg:self-stretch">
                    {assign.balancing ? <Loader2 className="animate-spin" /> : <Scale />}
                    Auto-balance across all teams
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Manual tools */}
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900">Adjust by hand</h3>
        <p className="text-sm text-slate-600">
          Expand a team to search and filter its bins, see which are already counted, move bins to another team or
          remove them. Select unassigned bins below to give them to a team.
        </p>
      </div>
      <TeamAssignmentsCard assign={assign} readOnly={closed} filters={filters} reassign={reassign} />
      <UnassignedBinsCard assign={assign} readOnly={closed} />

      <ReassignDialog assign={assign} reassign={reassign} />
      {assign.confirmDialog}
      {confirmDialog}
    </div>
  );
}
