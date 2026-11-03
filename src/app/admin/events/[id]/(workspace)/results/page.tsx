"use client";

import { Suspense } from "react";
import { useAdminEvent } from "@/components/admin/event-context";
import { CompletedDashboardContent } from "@/components/completed/completed-dashboard";
import { LoadingState } from "@/components/admin/loading-state";

// Results tab. Interim: the shared completed-summary screen, pinned to this event. Phase 2 restyles it.
export default function EventResultsPage() {
  const { eventId } = useAdminEvent();
  return (
    <Suspense fallback={<LoadingState />}>
      <CompletedDashboardContent key={eventId} eventId={String(eventId)} />
    </Suspense>
  );
}
