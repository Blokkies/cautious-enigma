// Go-live checklist lines from the readiness response. Pure (tested).

import { plural } from "@/lib/format";
import type { SetupStep } from "@/lib/admin-routes";
import type { Readiness } from "./use-event-data";

export interface CheckLine {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  step: SetupStep;
}

/** The go-live requirements as checklist lines. Pure. */
export function readinessLines(r: Readiness): CheckLine[] {
  const items = r.itemCount;
  const teams = r.teamCount;
  const sups = r.supervisorCount;
  return [
    {
      key: "items",
      ok: r.hasItems,
      label: "Stock file imported",
      detail: r.hasItems
        ? `${items !== undefined ? plural(items, "item") : "Items"} in the selected warehouses`
        : "No items in the selected warehouses yet",
      step: "items",
    },
    {
      key: "teams",
      ok: r.hasTeams,
      label: "At least one counting team",
      detail: r.hasTeams ? (teams !== undefined ? plural(teams, "team") : "Teams added") : "No teams yet",
      step: "people",
    },
    {
      key: "supervisors",
      ok: r.hasSupervisors,
      label: "At least one supervisor",
      detail: r.hasSupervisors
        ? sups !== undefined
          ? plural(sups, "supervisor")
          : "Supervisors added"
        : "No supervisor yet",
      step: "people",
    },
    {
      key: "bins",
      ok: r.hasItems && r.allItemsAssigned,
      label: "Every item assigned to a team",
      detail: !r.hasItems
        ? "Import items first"
        : r.allItemsAssigned
          ? "All bins have a team"
          : `${plural(r.unassignedCount, "item")} unassigned`,
      step: "bins",
    },
  ];
}

