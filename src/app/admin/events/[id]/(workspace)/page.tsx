"use client";

import { useAdminEvent } from "@/components/admin/event-context";
import { ActivatePageContent } from "@/components/admin/legacy/activate-legacy";

// Workspace Overview tab. Interim: the previous readiness / status screen, pinned to this event.
// Phase 2 replaces it with the lifecycle stepper, readiness checklist and live KPIs.
export default function EventOverviewPage() {
  const { eventId } = useAdminEvent();
  return <ActivatePageContent key={eventId} eventId={String(eventId)} />;
}
