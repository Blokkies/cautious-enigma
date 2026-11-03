"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarDays, ChevronDown, Download, MapPin, MoreHorizontal, Pencil, SearchX, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dangerActions, primaryAction, statusTransitions } from "@/lib/event-lifecycle";
import { setupProgress } from "@/lib/setup-progress";
import { LIFECYCLE_COPY, useLifecycleAction } from "./panels/lifecycle-actions";
import { EditEventDetailsDialog } from "./panels/event-details-form";
import { readinessCounts, useEventReadiness } from "./panels/use-event-data";
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
    // overflow-y-hidden stops a 1px vertical scrollbar; the baseline is an inset shadow (not a border)
    // so the active tab's underline is not clipped by the scroll container.
    <nav
      aria-label="Event sections"
      className="scrollbar-none -mx-4 mb-6 overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 shadow-[inset_0_-1px_0_0_rgb(226_232_240)] sm:mx-0 sm:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {EVENT_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab}>
              <Link
                href={adminRoutes.event(eventId, tab)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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
 * `actions` replaces the default header actions (the contextual next step and the actions menu).
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

  const defaultActions = <WorkspaceActions />;

  return (
    <>
      <PageHeader
        className="mb-4"
        breadcrumbs={[{ label: "Events", href: adminRoutes.events }, { label: event.name }]}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 [overflow-wrap:anywhere]">{event.name}</span>
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

/**
 * Header actions: the contextual next step (Continue setup / Go live / Mark complete / Lock /
 * Reopen) and a menu with edit details, download items, the other status change, reset and delete.
 */
export function WorkspaceActions() {
  const { event } = useAdminEvent();
  const inSetup = event?.status === "setup";
  const readiness = useEventReadiness(event, inSetup);
  const { run, dialog } = useLifecycleAction();
  const [editOpen, setEditOpen] = useState(false);
  if (!event) return null;

  const progress = readiness.data ? setupProgress(readinessCounts(readiness.data)) : null;
  const primary = primaryAction(event.status, !!progress?.ready);
  const secondaryTransitions = statusTransitions(event.status).filter((a) => a !== primary);
  const dangers = dangerActions(event.status);

  let primaryButton: React.ReactNode = null;
  if (primary === "continue-setup") {
    primaryButton = (
      <Button asChild>
        <Link href={adminRoutes.setup(event.id, progress?.next ?? "items")}>
          <Wand2 />
          Continue setup
        </Link>
      </Button>
    );
  } else if (primary) {
    const copy = LIFECYCLE_COPY[primary];
    const Icon = copy.icon;
    primaryButton = (
      <Button onClick={() => void run(primary)}>
        <Icon />
        {copy.label}
      </Button>
    );
  }

  return (
    <>
      {primaryButton}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="More actions">
            <MoreHorizontal className="sm:hidden" />
            <span className="hidden sm:inline">Actions</span>
            <ChevronDown className="hidden sm:inline" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil />
            Edit details
          </DropdownMenuItem>
          {inSetup && primary !== "continue-setup" && (
            <DropdownMenuItem asChild>
              <Link href={adminRoutes.setup(event.id, "review")}>
                <Wand2 />
                Open setup wizard
              </Link>
            </DropdownMenuItem>
          )}
          {event.totalItemCount > 0 && (
            <DropdownMenuItem asChild>
              <a href={`/api/admin/export?eventId=${event.id}`} download>
                <Download />
                Download imported items
              </a>
            </DropdownMenuItem>
          )}
          {secondaryTransitions.length > 0 && <DropdownMenuSeparator />}
          {secondaryTransitions.map((a) => {
            const Icon = LIFECYCLE_COPY[a].icon;
            return (
              <DropdownMenuItem key={a} onSelect={() => void run(a)}>
                <Icon />
                {LIFECYCLE_COPY[a].label}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-slate-500">Danger zone</DropdownMenuLabel>
          {dangers.map((a) => {
            const Icon = LIFECYCLE_COPY[a].icon;
            return (
              <DropdownMenuItem key={a} onSelect={() => void run(a)} className="text-red-700 focus:bg-red-50 focus:text-red-800">
                <Icon />
                {LIFECYCLE_COPY[a].label} stocktake
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditEventDetailsDialog open={editOpen} onOpenChange={setEditOpen} />
      {dialog}
    </>
  );
}
