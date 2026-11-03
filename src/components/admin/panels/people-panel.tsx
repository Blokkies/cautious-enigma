"use client";

import { useCallback } from "react";
import { TeamsManager } from "@/components/teams/teams-manager";
import type { SupervisorInfo, TeamInfo } from "@/components/teams/types";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/pin";
import { useAdminEvent } from "../event-context";
import { ListSkeleton } from "../loading-state";
import { ErrorState } from "../error-state";
import { InfoNote } from "./panel-section";
import { useJson } from "./use-event-data";

/** Teams, supervisors and auditors of the current event (admin). */
export function PeoplePanel({ onChanged }: { onChanged?: () => void }) {
  const { event, reload: reloadEvent } = useAdminEvent();
  const eventId = event!.id;
  const closed = event!.status === "completed" || event!.status === "locked";
  const people = useJson<{ teams: TeamInfo[]; supervisors: SupervisorInfo[] }>(`/api/admin/teams?eventId=${eventId}`);
  const { reload } = people;

  const afterChange = useCallback(() => {
    void reload();
    void reloadEvent();
    onChanged?.();
  }, [reload, reloadEvent, onChanged]);

  if (people.loading) return <ListSkeleton rows={4} />;
  if (people.error && !people.data) {
    return <ErrorState title="Could not load the people" message={people.error} onRetry={() => void reload()} />;
  }

  return (
    <div className="space-y-4">
      {closed ? (
        <InfoNote tone="warning">
          Counting has finished. You can still rename teams or change PINs, but deleting a team would delete its counts,
          so that is blocked.
        </InfoNote>
      ) : (
        <InfoNote>
          Everyone logs in on the home page: they choose their role, this stocktake and their name, then enter their PIN
          ({PIN_MIN_LENGTH} to {PIN_MAX_LENGTH} digits). Use Show PINs to check them.
        </InfoNote>
      )}
      <TeamsManager
        variant="admin"
        eventId={String(eventId)}
        teamsList={people.data?.teams ?? []}
        supervisorsList={people.data?.supervisors ?? []}
        reloadTeams={afterChange}
      />
    </div>
  );
}
