"use client";

import { useAdminEvent } from "@/components/admin/event-context";
import { AssignPageContent } from "@/components/admin/legacy/assign-legacy";

// Bins tab. Interim: the previous assignment screen, pinned to this event. Phase 2 replaces it.
export default function EventBinsPage() {
  const { eventId } = useAdminEvent();
  return <AssignPageContent key={eventId} eventId={String(eventId)} />;
}
