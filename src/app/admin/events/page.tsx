"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, ChevronRight, Plus, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminRoutes, SETUP_STEP_LABELS } from "@/lib/admin-routes";
import { formatDateRange, formatNumber, plural } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { ListSkeleton } from "@/components/admin/loading-state";
import {
  countByStatus,
  filterEvents,
  isStatusFilter,
  setupChecklist,
  STATUS_FILTERS,
  type DashboardEvent,
  type EventListItem,
  type StatusFilter,
} from "@/components/admin/event-list";

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  setup: "In setup",
  active: "Live",
  completed: "Completed",
  locked: "Locked",
};

export default function AdminEventsPage() {
  return (
    <Suspense fallback={<EventsHeader />}>
      <EventsPageBody />
    </Suspense>
  );
}

function EventsHeader() {
  return (
    <PageHeader
      title="Events"
      description="Every stocktake, from setup to locked. Open one to manage its items, people, bins, results and exports."
      actions={
        <Button asChild>
          <Link href={adminRoutes.newEvent}>
            <Plus />
            New stocktake
          </Link>
        </Button>
      }
    />
  );
}

function EventsPageBody() {
  const router = useRouter();
  const pathname = usePathname() ?? adminRoutes.events;
  const searchParams = useSearchParams();
  const rawStatus = searchParams?.get("status");
  const status: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : "all";
  const [query, setQuery] = useState(searchParams?.get("q") ?? "");

  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Progress and next setup step come from the dashboard; it loads after the list.
  const [progress, setProgress] = useState<Map<number, DashboardEvent> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
    try {
      const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const list: DashboardEvent[] = Array.isArray(data?.events) ? data.events : [];
        setProgress(new Map(list.map((e) => [e.id, e])));
      }
    } catch {
      // Progress is a nice-to-have; the list works without it.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void load();
  }, [load]);

  const retry = () => {
    setLoading(true);
    load();
  };

  // Keep the filter and search in the URL so the view can be bookmarked and Back works.
  const setParams = useCallback(
    (next: { status?: StatusFilter; q?: string }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      const s = next.status ?? status;
      const q = next.q ?? query;
      if (s === "all") params.delete("status");
      else params.set("status", s);
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, query, router, searchParams, status]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchParams?.get("q") ?? "") !== query.trim()) setParams({ q: query });
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchParams, setParams]);

  const counts = useMemo(() => countByStatus(events ?? []), [events]);
  const visible = useMemo(() => filterEvents(events ?? [], status, query), [events, status, query]);

  return (
    <>
      <EventsHeader />

      {events === null ? (
        error ? (
          <ErrorState title="Could not load events" message={error} onRetry={retry} retrying={loading} />
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-9 w-full max-w-md" />
            <ListSkeleton rows={6} />
          </div>
        )
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No stocktakes yet"
          description="Create one to get started. The setup wizard walks you through the stock file, people and bins, and you can leave and come back at any step."
          action={
            <Button asChild>
              <Link href={adminRoutes.newEvent}>
                <Plus />
                New stocktake
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div role="radiogroup" aria-label="Filter by status" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 py-0.5 md:mx-0 md:px-0">
              {STATUS_FILTERS.map((f) => {
                const n = f === "all" ? counts.total : counts[f];
                const active = status === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setParams({ status: f })}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-white font-medium text-slate-900 ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
                    )}
                  >
                    {FILTER_LABELS[f]}
                    <span className={cn("rounded px-1 text-xs tabular-nums", active ? "bg-slate-100 text-slate-700" : "text-slate-400")}>{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or location"
                aria-label="Search events"
                className="h-9 bg-white pl-8 pr-8"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No events match"
              description={
                query
                  ? `Nothing ${status === "all" ? "" : `${FILTER_LABELS[status].toLowerCase()} `}matches "${query}". Check the spelling or clear the search.`
                  : `There are no ${FILTER_LABELS[status].toLowerCase()} events right now.`
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    router.replace(pathname, { scroll: false });
                  }}
                >
                  Show all events
                </Button>
              }
            />
          ) : (
            <>
              <EventsTable events={visible} progress={progress} />
              <EventsCards events={visible} progress={progress} />
              <p className="text-xs text-slate-500">
                Showing {visible.length} of {events.length} {events.length === 1 ? "event" : "events"}.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Progress for live/finished events, next setup step for events in setup. */
function ProgressCell({ event, info }: { event: EventListItem; info: DashboardEvent | undefined | null }) {
  if (info === undefined) return <span className="text-xs text-slate-400">–</span>;
  if (info === null) return <Skeleton className="h-4 w-24" />;
  if (event.status === "setup") {
    const c = setupChecklist(info.setup ?? { itemCount: 0, teamCount: 0, supervisorCount: 0, unassignedCount: 0 });
    return (
      <span className="text-xs">
        {c.ready ? (
          <span className="font-medium text-emerald-700">Ready to go live</span>
        ) : (
          <>
            <span className="text-slate-500">Next: </span>
            <span className="font-medium text-slate-700">{SETUP_STEP_LABELS[c.next]}</span>
          </>
        )}
        <span className="ml-1.5 text-slate-400 tabular-nums">
          ({c.completed}/{c.total})
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, info.progressPercent)}%` }} />
      </span>
      <span className="text-xs tabular-nums text-slate-700">{info.progressPercent}%</span>
    </span>
  );
}

function cellInfo(progress: Map<number, DashboardEvent> | null, id: number): DashboardEvent | undefined | null {
  if (progress === null) return null;
  return progress.get(id);
}

function EventsTable({ events, progress }: { events: EventListItem[]; progress: Map<number, DashboardEvent> | null }) {
  const router = useRouter();
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-medium text-slate-500">
            <th scope="col" className="w-full min-w-[10rem] px-4 py-2.5 font-medium">Name</th>
            <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 font-medium xl:table-cell">Dates</th>
            <th scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">Status</th>
            <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Items</th>
            <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Teams</th>
            <th scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">Progress</th>
            <th scope="col" className="w-8 px-2 py-2.5"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {events.map((e) => {
            const href = adminRoutes.event(e.id);
            const dates = formatDateRange(e.startDate, e.endDate);
            return (
              <tr
                key={e.id}
                onClick={(ev) => {
                  // Let real links and modifier-clicks behave normally.
                  if ((ev.target as HTMLElement).closest("a") || ev.metaKey || ev.ctrlKey) return;
                  router.push(href);
                }}
                className="group cursor-pointer transition-colors hover:bg-slate-50"
              >
                {/* Name takes the spare width and wraps (max two lines) only when it really runs out of room. */}
                <td className="min-w-[10rem] px-4 py-3">
                  <Link
                    href={href}
                    title={e.name}
                    className="line-clamp-2 break-words rounded font-medium text-slate-900 group-hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {e.name}
                  </Link>
                  <div className="line-clamp-1 break-words text-xs text-slate-500">
                    {e.location || <span className="text-slate-400">No location</span>}
                    <span className="xl:hidden">{dates && `, ${dates}`}</span>
                  </div>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-slate-600 xl:table-cell">{dates || <span className="text-slate-400">Not set</span>}</td>
                <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={e.status} size="sm" /></td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatNumber(e.totalItemCount)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatNumber(e.teamCount)}</td>
                <td className="whitespace-nowrap px-4 py-3"><ProgressCell event={e} info={cellInfo(progress, e.id)} /></td>
                <td className="px-2 py-3 text-slate-300 group-hover:text-slate-500"><ChevronRight className="h-4 w-4" aria-hidden="true" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventsCards({ events, progress }: { events: EventListItem[]; progress: Map<number, DashboardEvent> | null }) {
  return (
    <ul className="space-y-2 md:hidden">
      {events.map((e) => {
        const dates = formatDateRange(e.startDate, e.endDate);
        return (
          <li key={e.id}>
            <Link
              href={adminRoutes.event(e.id)}
              className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="line-clamp-2 break-words font-medium text-slate-900">{e.name}</div>
                  <div className="truncate text-xs text-slate-500">{[e.location, dates].filter(Boolean).join(", ") || "No location or dates"}</div>
                </div>
                <StatusBadge status={e.status} size="sm" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="tabular-nums">
                  {plural(e.totalItemCount, "item")}, {plural(e.teamCount, "team")}
                </span>
                <ProgressCell event={e} info={cellInfo(progress, e.id)} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
