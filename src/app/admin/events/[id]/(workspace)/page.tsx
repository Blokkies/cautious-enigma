"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  MessageSquare,
  Package,
  ScanBarcode,
  TrendingDown,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { adminRoutes, SETUP_STEP_LABELS } from "@/lib/admin-routes";
import { formatMoney, formatNumber } from "@/lib/format";
import { setupProgress } from "@/lib/setup-progress";
import { useAdminEvent } from "@/components/admin/event-context";
import { LifecycleStepper } from "@/components/admin/lifecycle-stepper";
import { StatCard } from "@/components/admin/stat-card";
import { StatCardsSkeleton } from "@/components/admin/loading-state";
import { ReadinessChecklist } from "@/components/admin/panels/readiness-checklist";
import { LifecycleActions } from "@/components/admin/panels/lifecycle-actions";
import { readinessCounts, useEventReadiness, useJson } from "@/components/admin/panels/use-event-data";

interface DashboardEvent {
  id: number;
  totalItems: number;
  countedItems: number;
  matchedItems: number;
  varianceItems: number;
  overCount: number;
  overValue: number;
  underCount: number;
  underValue: number;
  netVarianceValue: number;
  progressPercent: number;
  openQueries: number;
  pendingBreakdowns: number;
  openSerialDiscrepancies: number;
  lastCountAt: string | null;
}

/** "14:05" today, otherwise "3 Nov, 14:05". */
function lastCountLabel(at: string | null): string {
  if (!at) return "No counts yet";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? `Last count at ${time}`
    : `Last count ${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

/** Count progress and variance KPIs (refreshes every 15 s while live). */
function EventKpis({ eventId, live }: { eventId: number; live: boolean }) {
  const dashboard = useJson<{ events: DashboardEvent[] }>("/api/admin/dashboard");
  const { reload } = dashboard;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void reload(), 15000);
    return () => clearInterval(t);
  }, [live, reload]);

  if (dashboard.loading) return <StatCardsSkeleton />;
  const e = dashboard.data?.events.find((x) => x.id === eventId);
  if (!e) return null;
  const pending = Math.max(0, e.totalItems - e.countedItems);
  const attention = e.openQueries + e.pendingBreakdowns + e.openSerialDiscrepancies;

  return (
    <section className="space-y-3" aria-labelledby="kpi-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="kpi-heading" className="text-base font-semibold text-slate-900">
          {live ? "Count progress" : "Final figures"}
        </h2>
        <span className="text-xs text-slate-500">
          {lastCountLabel(e.lastCountAt)}
          {live && " · refreshes every 15 seconds"}
        </span>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{e.progressPercent}%</span>
          <span className="text-sm tabular-nums text-slate-500">
            {formatNumber(e.countedItems)} of {formatNumber(e.totalItems)} items counted
          </span>
        </div>
        <Progress value={e.progressPercent} className="mt-3 h-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Matched" value={formatNumber(e.matchedItems)} icon={CheckCircle2} tone="positive" />
        <StatCard label="Variances" value={formatNumber(e.varianceItems)} icon={AlertTriangle} tone={e.varianceItems > 0 ? "warning" : "default"} href={adminRoutes.event(eventId, "results")} />
        <StatCard label="Still to count" value={formatNumber(pending)} icon={Clock} />
        <StatCard
          label="Net variance"
          value={formatMoney(e.netVarianceValue, { decimals: 0, signed: true })}
          tone={e.netVarianceValue < 0 ? "negative" : e.netVarianceValue > 0 ? "warning" : "default"}
          hint={
            <>
              <TrendingUp className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {formatMoney(e.overValue, { decimals: 0 })} over ({e.overCount}) ·{" "}
              <TrendingDown className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {formatMoney(e.underValue, { decimals: 0 })} under ({e.underCount})
            </>
          }
        />
      </div>
      {attention > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {e.openQueries > 0 && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {e.openQueries} open {e.openQueries === 1 ? "query" : "queries"}
            </li>
          )}
          {e.pendingBreakdowns > 0 && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              {e.pendingBreakdowns} breakdown{e.pendingBreakdowns === 1 ? "" : "s"} awaiting approval
            </li>
          )}
          {e.openSerialDiscrepancies > 0 && (
            <li className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
              <ScanBarcode className="h-3.5 w-3.5" aria-hidden="true" />
              {e.openSerialDiscrepancies} serial discrepanc{e.openSerialDiscrepancies === 1 ? "y" : "ies"}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

// Workspace Overview: lifecycle, readiness (setup) or KPIs (live/finished), and every status change.
export default function EventOverviewPage() {
  const { event } = useAdminEvent();
  const inSetup = event?.status === "setup";
  const readiness = useEventReadiness(event, inSetup);
  if (!event) return null;

  const progress = readiness.data ? setupProgress(readinessCounts(readiness.data)) : null;

  return (
    <div className="space-y-6">
      <LifecycleStepper status={event.status} />

      {inSetup && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <ReadinessChecklist eventId={event.id} state={readiness} />
          <aside className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-slate-900">
                {progress?.ready ? "Everything is ready" : "Finish setting up"}
              </h3>
              <p className="text-sm text-slate-600">
                {progress?.ready
                  ? "Check the login sheet and go live when the teams are ready to start."
                  : "The setup wizard walks you through each step with guidance, and picks up where you left off."}
              </p>
              {progress && !progress.ready && (
                <p className="text-sm text-slate-600">
                  Next step: <span className="font-medium text-slate-900">{SETUP_STEP_LABELS[progress.next]}</span>
                </p>
              )}
            </div>
            <Button asChild>
              <Link href={adminRoutes.setup(event.id, progress?.next ?? "items")}>
                <Wand2 />
                {progress?.ready ? "Review and go live" : "Continue setup"}
                <ArrowRight />
              </Link>
            </Button>
          </aside>
        </div>
      )}

      {!inSetup && <EventKpis eventId={event.id} live={event.status === "active"} />}

      {!inSetup && (
        <p className="text-sm text-slate-600">
          See the details on the{" "}
          <Link href={adminRoutes.event(event.id, "results")} className="font-medium text-primary hover:underline">
            Results
          </Link>{" "}
          tab and download NetSuite files on the{" "}
          <Link href={adminRoutes.event(event.id, "exports")} className="font-medium text-primary hover:underline">
            Exports
          </Link>{" "}
          tab.
        </p>
      )}

      <LifecycleActions goLiveDisabledReason={inSetup ? (readiness.data?.blocker ?? (readiness.loading ? "Checking readiness…" : null)) : null} />
    </div>
  );
}
