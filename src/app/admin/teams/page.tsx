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
import { TeamsManager } from "@/components/teams/teams-manager";
import type { EventOption, SupervisorInfo, TeamInfo } from "@/components/teams/types";

function TeamsPageContent() {
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(urlEventId || "");
  const [teamsList, setTeamsList] = useState<TeamInfo[]>([]);
  const [supervisorsList, setSupervisorsList] = useState<SupervisorInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events || []);
      if (!urlEventId) {
        const setupEvent = data.events?.find(
          (e: EventOption) => e.status === "setup" || e.status === "active"
        );
        if (setupEvent) setSelectedEventId(String(setupEvent.id));
      }
    }
    setLoading(false);
  }, [urlEventId]);

  const loadTeams = useCallback(async () => {
    if (!selectedEventId) return;
    const res = await fetch(`/api/admin/teams?eventId=${selectedEventId}`);
    if (res.ok) {
      const data = await res.json();
      setTeamsList(data.teams || []);
      setSupervisorsList(data.supervisors || []);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (selectedEventId) loadTeams();
  }, [selectedEventId, loadTeams]);

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  const selectedEvent = events.find((e) => String(e.id) === selectedEventId);

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
        <span className="text-muted-foreground">Teams</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams & Supervisors</h1>
        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select event..." />
          </SelectTrigger>
          <SelectContent>
            {events.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TeamsManager
        variant="admin"
        eventId={selectedEventId}
        teamsList={teamsList}
        supervisorsList={supervisorsList}
        reloadTeams={loadTeams}
      />
    </div>
  );
}

// useSearchParams() needs a Suspense boundary for static prerendering (Next 15+).
export default function TeamsPage() {
  return (
    <Suspense fallback={null}>
      <TeamsPageContent />
    </Suspense>
  );
}
