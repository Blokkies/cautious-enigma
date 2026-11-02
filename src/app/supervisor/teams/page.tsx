"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { TeamsManager } from "@/components/teams/teams-manager";
import type { SupervisorInfo, TeamInfo } from "@/components/teams/types";

export default function SupervisorTeamsPage() {
  const { user, loading: authLoading } = useAuth();
  const isAuditor = user?.type === "auditor";
  const eventId = user?.eventId;

  const [teamsList, setTeamsList] = useState<TeamInfo[]>([]);
  const [supervisorsList, setSupervisorsList] = useState<SupervisorInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTeams = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await fetch(`/api/admin/teams?eventId=${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setTeamsList(data.teams || []);
        setSupervisorsList(data.supervisors || []);
      }
    } catch {
      toast.error("Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // loadTeams returns early without an event, so only wait while one is known
  if (authLoading || (loading && eventId)) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  if (!eventId) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No stocktake event is linked to this account.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams & Supervisors</h1>
        <Link href="/supervisor/teams/assign">
          <Button variant="outline" className="gap-1">
            Assign Bins
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <TeamsManager
        variant="supervisor"
        eventId={String(eventId)}
        readOnly={isAuditor}
        teamsList={teamsList}
        supervisorsList={supervisorsList}
        reloadTeams={loadTeams}
      />
    </div>
  );
}
