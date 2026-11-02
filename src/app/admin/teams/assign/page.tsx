"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAssignment } from "@/components/teams/use-assignment";
import { AssignProgressCard, TeamAssignmentsCard, UnassignedBinsCard } from "@/components/teams/assign-cards";
import type { EventOption } from "@/components/teams/types";

function AssignPageContent() {
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>(urlEventId || "");

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      const allEvents: EventOption[] = (data.events || []).filter(
        (e: EventOption) => e.status === "setup" || e.status === "active"
      );
      setEvents(allEvents);
      if (allEvents.length > 0 && !urlEventId && !eventId) {
        setEventId(String(allEvents[0].id));
      }
    }
  }, [urlEventId, eventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const assign = useAssignment(eventId);

  const selectedEvent = events.find((e) => String(e.id) === eventId);

  if (assign.loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/setup"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Events
        </Link>
        {selectedEvent && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{selectedEvent.name}</span>
          </>
        )}
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Assign</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Assign Items to Teams</h1>
        {events.length > 1 && (
          <Select value={eventId} onValueChange={(v) => {
            setEventId(v);
            assign.resetForEventChange();
          }}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select event..." />
            </SelectTrigger>
            <SelectContent>
              {events.map((ev) => (
                <SelectItem key={ev.id} value={String(ev.id)}>
                  {ev.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <AssignProgressCard assign={assign} />
      <TeamAssignmentsCard assign={assign} />
      <UnassignedBinsCard assign={assign} />
    </div>
  );
}

// useSearchParams() needs a Suspense boundary for static prerendering (Next 15+).
export default function AssignPage() {
  return (
    <Suspense fallback={null}>
      <AssignPageContent />
    </Suspense>
  );
}
