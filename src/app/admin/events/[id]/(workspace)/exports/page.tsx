"use client";

import { Suspense } from "react";
import { useAdminEvent } from "@/components/admin/event-context";
import { ExportPageContent } from "@/components/export/export-page-content";
import { LoadingState } from "@/components/admin/loading-state";

// Exports tab. Interim: the shared export screen, pinned to this event. Phase 2 restyles it.
export default function EventExportsPage() {
  const { eventId } = useAdminEvent();
  return (
    <Suspense fallback={<LoadingState />}>
      <ExportPageContent key={eventId} eventId={eventId} />
    </Suspense>
  );
}
