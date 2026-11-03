"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  BarChart3,
  Check,
  CircleDot,
  Clock,
  FileOutput,
  Loader2,
  MessageSquare,
  Package,
  Plus,
  RotateCw,
  ScanBarcode,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { downloadAllAsZip } from "@/lib/download-all-zip";
import { adminRoutes, SETUP_STEP_LABELS, SETUP_STEPS } from "@/lib/admin-routes";
import { formatMoney, formatNumber, plural } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { StatCard } from "@/components/admin/stat-card";
import { ErrorState } from "@/components/admin/error-state";
import { StatCardsSkeleton } from "@/components/admin/loading-state";
import { EventMeta } from "@/components/admin/event-workspace";
import {
  countByStatus,
  eventZipName,
  groupEvents,
  setupChecklist,
  timeAgo,
  type DashboardEvent,
} from "@/components/admin/event-list";

const REFRESH_MS = 15_000;

/** Polls the dashboard. Refreshes keep the current data on screen (no flicker). */
function useDashboard() {
  const [events, setEvents] = useState<DashboardEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const retry = useCallback(() => {
    setRetrying(true);
    load().finally(() => setRetrying(false));
  }, [load]);

  return { events, error, retrying, updatedAt, retry };
}

export default function AdminOverviewPage() {
  const { events, error, retrying, updatedAt, retry } = useDashboard();

  const header = (
    <PageHeader
      title="Overview"
      description="Every stocktake at a glance. Live numbers refresh every 15 seconds."
      actions={
        events && events.length > 0 ? (
          <Button asChild>
            <Link href={adminRoutes.newEvent}>
              <Plus />
              New stocktake
            </Link>
          </Button>
        ) : undefined
      }
    >
      {events && events.length > 0 && <RefreshNote updatedAt={updatedAt} refreshing={retrying} error={error} onRetry={retry} />}
    </PageHeader>
  );

  if (events === null) {
    return (
      <>
        {header}
        {error ? (
          <ErrorState title="Could not load the overview" message={error} onRetry={retry} retrying={retrying} />
        ) : (
          <OverviewSkeleton />
        )}
      </>
    );
  }

  if (events.length === 0) {
    return (
      <>
        {header}
        <Welcome />
      </>
    );
  }

  const counts = countByStatus(events);
  const groups = groupEvents(events);
  const finished = [...groups.finished, ...groups.other];

  return (
    <>
      {header}
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Live now" value={counts.active} icon={CircleDot} hint="Counting open" href={`${adminRoutes.events}?status=active`} />
          <StatCard label="In setup" value={counts.setup} icon={Clock} hint="Being prepared" href={`${adminRoutes.events}?status=setup`} />
          <StatCard label="Completed" value={counts.completed} icon={Check} hint="Ready to review and export" href={`${adminRoutes.events}?status=completed`} />
          <StatCard label="Locked" value={counts.locked} icon={Archive} hint="Closed and archived" href={`${adminRoutes.events}?status=locked`} />
        </div>

        {groups.live.length > 0 && (
          <Section title="Live now" description="Teams are counting. Open an event to follow progress or reassign bins.">
            <div className="grid gap-4 xl:grid-cols-2">
              {groups.live.map((e) => (
                <LiveEventCard key={e.id} event={e} />
              ))}
            </div>
          </Section>
        )}

        {groups.setup.length > 0 && (
          <Section title="In setup" description="Pick up where you left off. Each step is saved as you go.">
            <div className="grid gap-4 lg:grid-cols-2">
              {groups.setup.map((e) => (
                <SetupEventCard key={e.id} event={e} />
              ))}
            </div>
          </Section>
        )}

        {finished.length > 0 && (
          <Section title="Finished" description="Counting has stopped. Review the results and send the variances to NetSuite.">
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {finished.map((e) => (
                <FinishedEventRow key={e.id} event={e} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function RefreshNote({
  updatedAt,
  refreshing,
  error,
  onRetry,
}: {
  updatedAt: Date | null;
  refreshing: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-red-700" role="status">
        Could not refresh: {error}
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 hover:text-red-900">
          Try again
        </button>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite">
      <RotateCw className={cn("h-3 w-3", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      {updatedAt
        ? `Updated ${updatedAt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : "Updating…"}
    </p>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

const PHASES = [
  {
    title: "Set up",
    body: "Name the stocktake, upload the NetSuite stock file, add teams and supervisors, and assign every bin to a team. The wizard walks you through it.",
  },
  {
    title: "Go live",
    body: "Hand out the login sheet and open counting. Teams log in on their phones with a PIN.",
  },
  {
    title: "Count",
    body: "Teams count their bins, even offline. You and the supervisors watch progress here in real time.",
  },
  {
    title: "Review",
    body: "Supervisors check variances, order recounts and resolve serial number differences.",
  },
  {
    title: "Close & export",
    body: "Mark the stocktake complete, download the NetSuite adjustment files and lock it.",
  },
];

function Welcome() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-5 sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">Welcome. Let&apos;s run your first stocktake.</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Every stocktake goes through the same five phases. Setting one up takes about fifteen minutes if you have the
          NetSuite stock file ready, and you can stop and come back at any point.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href={adminRoutes.newEvent}>
              <Plus />
              Create your first stocktake
            </Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="text-slate-600">
            <Link href={adminRoutes.help("lifecycle")}>Read the guide first</Link>
          </Button>
        </div>
      </div>
      <ol className="grid divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        {PHASES.map((phase, i) => (
          <li key={phase.title} className="p-5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  i === 0 ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-600"
                )}
              >
                {i + 1}
              </span>
              <h3 className="text-sm font-semibold text-slate-900">{phase.title}</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{phase.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <article className={cn("flex flex-col rounded-lg border border-slate-200 bg-white p-4 sm:p-5", className)}>{children}</article>;
}

function CardTitle({ event }: { event: DashboardEvent }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="truncate text-base font-semibold text-slate-900">
          <Link href={adminRoutes.event(event.id)} className="rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {event.name}
          </Link>
        </h3>
        <EventMeta location={event.location} startDate={event.startDate} endDate={event.endDate} />
      </div>
      <StatusBadge status={event.status} />
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "positive" | "warning" | "negative" | "muted" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-sm font-semibold tabular-nums",
          tone === "positive" && "text-emerald-700",
          tone === "warning" && "text-amber-700",
          tone === "negative" && "text-red-700",
          tone === "muted" && "text-slate-500",
          !tone && "text-slate-900"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Attention({ icon: Icon, count, label, tone }: { icon: typeof MessageSquare; count: number; label: string; tone: "amber" | "violet" }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tone === "amber" ? "bg-amber-50 text-amber-800 ring-amber-600/20" : "bg-violet-50 text-violet-700 ring-violet-600/20"
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {formatNumber(count)} {label}
    </span>
  );
}

function LiveEventCard({ event }: { event: DashboardEvent }) {
  const pending = Math.max(0, event.totalItems - event.countedItems);
  const lastCount = timeAgo(event.lastCountAt);
  const hasAttention = event.openQueries + event.pendingBreakdowns + event.openSerialDiscrepancies > 0;

  return (
    <CardShell>
      <CardTitle event={event} />

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{event.progressPercent}%</div>
          <div className="text-xs text-slate-500">
            {formatNumber(event.countedItems)} of {formatNumber(event.totalItems)} items counted
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">{lastCount ? `Last count ${lastCount}` : "No counts yet"}</div>
      </div>
      <Progress
        value={event.progressPercent}
        className="mt-2 h-2 bg-slate-100"
        aria-label={`${event.progressPercent}% counted`}
      />

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <Figure label="Matched" value={formatNumber(event.matchedItems)} tone="positive" />
        <Figure label="Variances" value={formatNumber(event.varianceItems)} tone={event.varianceItems > 0 ? "warning" : undefined} />
        <Figure label="Pending" value={formatNumber(pending)} tone="muted" />
        <Figure label={`Over (${formatNumber(event.overCount)})`} value={formatMoney(event.overValue, { decimals: 0 })} tone="warning" />
        <Figure label={`Under (${formatNumber(event.underCount)})`} value={formatMoney(-Math.abs(event.underValue), { decimals: 0 })} tone="negative" />
        <Figure
          label="Net"
          value={formatMoney(event.netVarianceValue, { decimals: 0, signed: true })}
          tone={event.netVarianceValue > 0 ? "warning" : event.netVarianceValue < 0 ? "negative" : undefined}
        />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {plural(event.teamCount, "team")}, {plural(event.supervisorCount, "supervisor")}
        </span>
        {hasAttention && <span className="text-slate-300" aria-hidden="true">|</span>}
        <Attention icon={MessageSquare} count={event.openQueries} label={event.openQueries === 1 ? "open query" : "open queries"} tone="amber" />
        <Attention icon={Package} count={event.pendingBreakdowns} label={event.pendingBreakdowns === 1 ? "breakdown to approve" : "breakdowns to approve"} tone="amber" />
        <Attention
          icon={ScanBarcode}
          count={event.openSerialDiscrepancies}
          label={event.openSerialDiscrepancies === 1 ? "serial discrepancy" : "serial discrepancies"}
          tone="violet"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <Button asChild size="sm">
          <Link href={adminRoutes.event(event.id)}>
            Open event
            <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={adminRoutes.event(event.id, "results")}>
            <BarChart3 />
            Results
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="text-slate-600">
          <Link href={adminRoutes.event(event.id, "bins")}>Bins</Link>
        </Button>
      </div>
    </CardShell>
  );
}

function SetupEventCard({ event }: { event: DashboardEvent }) {
  const counts = event.setup ?? { itemCount: 0, teamCount: 0, supervisorCount: 0, unassignedCount: 0 };
  const checklist = setupChecklist(counts);
  const steps = SETUP_STEPS.filter((s) => s !== "review");

  const detail: Record<(typeof steps)[number], string> = {
    details: "Name and dates",
    items: counts.itemCount > 0 ? plural(counts.itemCount, "item") : "No stock file yet",
    warehouses: counts.itemCount > 0 ? "In scope chosen" : "After the stock file",
    people:
      counts.teamCount > 0 || counts.supervisorCount > 0
        ? `${counts.teamCount} ${counts.teamCount === 1 ? "team" : "teams"}, ${counts.supervisorCount} ${counts.supervisorCount === 1 ? "supervisor" : "supervisors"}`
        : "No teams yet",
    bins:
      counts.itemCount === 0
        ? "After the stock file"
        : counts.unassignedCount === 0
          ? "All assigned"
          : `${plural(counts.unassignedCount, "item")} unassigned`,
  };

  return (
    <CardShell>
      <CardTitle event={event} />

      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {checklist.completed} of {checklist.total} setup steps done
        </span>
        {checklist.ready && <span className="font-medium text-emerald-700">Ready to go live</span>}
      </div>
      <Progress value={checklist.percent} className="mt-2 h-1.5 bg-slate-100" aria-label={`${checklist.completed} of ${checklist.total} setup steps done`} />

      <ul className="mt-4 flex-1 space-y-2">
        {steps.map((step) => {
          const done = checklist.done[step];
          const isNext = !checklist.ready && checklist.next === step;
          return (
            <li key={step} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  done ? "bg-emerald-500 text-white" : isNext ? "border-2 border-primary" : "border border-slate-300"
                )}
              >
                {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span className={cn("w-24 shrink-0", done ? "text-slate-700" : isNext ? "font-medium text-slate-900" : "text-slate-500")}>
                {SETUP_STEP_LABELS[step]}
              </span>
              <span className="truncate text-xs text-slate-500">
                <span className="sr-only">{done ? "Done: " : "To do: "}</span>
                {detail[step]}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <Button asChild size="sm">
          <Link href={adminRoutes.setup(event.id, checklist.next)}>
            {checklist.ready ? "Review and go live" : `Continue setup: ${SETUP_STEP_LABELS[checklist.next]}`}
            <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="text-slate-600">
          <Link href={adminRoutes.event(event.id)}>Open event</Link>
        </Button>
      </div>
    </CardShell>
  );
}

function FinishedEventRow({ event }: { event: DashboardEvent }) {
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async () => {
    setDownloading("Starting…");
    try {
      await downloadAllAsZip(event.id, eventZipName(event.name), (done, total) => setDownloading(`${done} of ${total} files`));
      toast.success(`Reports for "${event.name}" downloaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The ZIP could not be built. Try again.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={adminRoutes.event(event.id)}
            className="truncate rounded text-sm font-semibold text-slate-900 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {event.name}
          </Link>
          <StatusBadge status={event.status} size="sm" />
        </div>
        <EventMeta location={event.location} startDate={event.startDate} endDate={event.endDate} />
      </div>
      <dl className="grid grid-cols-3 gap-4 md:w-80">
        <Figure label="Counted" value={`${event.progressPercent}%`} />
        <Figure label="Variances" value={formatNumber(event.varianceItems)} />
        <Figure
          label="Net"
          value={formatMoney(event.netVarianceValue, { decimals: 0, signed: true })}
          tone={event.netVarianceValue > 0 ? "warning" : event.netVarianceValue < 0 ? "negative" : undefined}
        />
      </dl>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href={adminRoutes.event(event.id, "results")}>
            <BarChart3 />
            Results
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={adminRoutes.event(event.id, "exports")}>
            <FileOutput />
            Exports
          </Link>
        </Button>
        <Button size="sm" variant="ghost" className="text-slate-600" onClick={download} disabled={downloading !== null} title="Download every report for this event as one ZIP">
          {downloading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Archive />}
          {downloading ?? "Download all reports"}
        </Button>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-8">
      <StatCardsSkeleton />
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-white p-5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-2 h-4 w-32" />
              <Skeleton className="mt-6 h-8 w-20" />
              <Skeleton className="mt-3 h-2 w-full" />
              <div className="mt-6 grid grid-cols-3 gap-3">
                {Array.from({ length: 6 }, (_, j) => (
                  <Skeleton key={j} className="h-8" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
