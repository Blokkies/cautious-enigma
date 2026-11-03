"use client";

import { useAdminEvent } from "@/components/admin/event-context";
import { ImportPageContent } from "@/components/admin/legacy/import-legacy";

// Items tab. Interim: the previous import screen, pinned to this event. Phase 2 replaces it.
export default function EventItemsPage() {
  const { eventId } = useAdminEvent();
  return <ImportPageContent key={eventId} eventId={String(eventId)} />;
}
