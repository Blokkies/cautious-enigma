"use client";

import { Suspense } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminRoutes } from "@/lib/admin-routes";
import { useAdminEvent } from "@/components/admin/event-context";
import { CompletedDashboardContent } from "@/components/completed/completed-dashboard";
import { LoadingState } from "@/components/admin/loading-state";
import { EmptyState } from "@/components/admin/empty-state";

// Results tab: the shared completed-summary screen (overall, team results, top variances), pinned to this event.
export default function EventResultsPage() {
  const { event } = useAdminEvent();
  if (event!.status === "setup") {
    return (
      <EmptyState
        icon={BarChart3}
        title="No results yet"
        description="Results fill in as teams count. They appear here once the stocktake is live."
        action={
          <Button asChild variant="outline">
            <Link href={adminRoutes.event(event!.id)}>Back to overview</Link>
          </Button>
        }
      />
    );
  }
  return (
    <Suspense fallback={<LoadingState />}>
      <CompletedDashboardContent key={event!.id} eventId={String(event!.id)} />
    </Suspense>
  );
}
