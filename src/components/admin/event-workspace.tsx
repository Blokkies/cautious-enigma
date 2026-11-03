"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, MapPin, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activeEventTab, adminRoutes, EVENT_TABS, type EventTab } from "@/lib/admin-routes";
import { formatDateRange } from "@/lib/format";
import { useAdminEvent } from "./event-context";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";
import { ErrorState } from "./error-state";
import { EmptyState } from "./empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export const EVENT_TAB_LABELS: Record<EventTab, string> = {
  overview: "Overview",
  items: "Items",
  people: "People",
  bins: "Bins",
  results: "Results",
  exports: "Exports",
};

/** Location + date range line for an event. */
export function EventMeta({ location, startDate, endDate }: { location: string | null; startDate: string | null; endDate: string | null }) {
  const dates = formatDateRange(startDate, endDate);
  if (!location && !dates) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
      {location && (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {location}
        </span>
      )}
      {dates && (
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          {dates}
        </span>
      )}
    </div>
  );
}

/** Tab bar for the event workspace. Horizontal scroll on narrow screens. */
export function EventTabs({ eventId }: { eventId: number }) {
  const pathname = usePathname() ?? "";
  const active = activeEventTab(pathname, eventId);
  return (
    <nav aria-label="Event sections" className="-mx-4 mb-6 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {EVENT_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab}>
              <Link
                href={adminRoutes.event(eventId, tab)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive
                    ? "border-primary font-medium text-slate-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
                )}
              >
                {EVENT_TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Header + tabs for /admin/events/[id]/** workspace pages. Handles the event's loading,
 * error and not-found states; children render only once the event is loaded.
 * `actions` replaces the default primary action (phase 2 adds the contextual
 * next-step button and the actions menu).
 */
export function EventWorkspaceFrame({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  const { eventId, event, loading, error, notFound, reload } = useAdminEvent();

  if (loading) {
    return (
      <div role="status" aria-label="Loading event" className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-6 h-10 w-full" />
      </div>
    );
  }
  if (error && !event) {
    return <ErrorState title="Could not load this event" message={error} onRetry={() => void reload()} />;
  }
  if (notFound || !event) {
    return (
      <EmptyState
        icon={SearchX}
        title="Event not found"
        description={`There is no event with id ${eventId}. It may have been deleted.`}
        action={
          <Button asChild>
            <Link href={adminRoutes.events}>Back to events</Link>
          </Button>
        }
      />
    );
  }

  const defaultActions =
    event.status === "setup" ? (
      <Button asChild>
        <Link href={adminRoutes.setup(event.id, "details")}>Continue setup</Link>
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        className="mb-4"
        breadcrumbs={[{ label: "Events", href: adminRoutes.events }, { label: event.name }]}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="break-words">{event.name}</span>
            <StatusBadge status={event.status} />
          </span>
        }
        actions={actions ?? defaultActions}
      >
        <EventMeta location={event.location} startDate={event.startDate} endDate={event.endDate} />
      </PageHeader>
      <EventTabs eventId={event.id} />
      {children}
    </>
  );
}
