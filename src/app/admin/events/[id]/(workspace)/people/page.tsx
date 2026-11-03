"use client";

import { useAdminEvent } from "@/components/admin/event-context";
import { TeamsPageContent } from "@/components/admin/legacy/teams-legacy";

// People tab. Interim: the previous teams & supervisors screen, pinned to this event. Phase 2 replaces it.
export default function EventPeoplePage() {
  const { eventId } = useAdminEvent();
  return <TeamsPageContent key={eventId} eventId={String(eventId)} />;
}
