// Where an event is in the setup wizard, derived from server counts. Pure: usable on server and client.

import type { SetupStep } from "./admin-routes";

export interface SetupCounts {
  itemCount: number;
  teamCount: number;
  supervisorCount: number;
  /** In-scope items not yet assigned to a team. */
  unassignedCount: number;
}

export interface SetupProgress {
  /** Steps whose requirement is met. "details" is always done once the event exists. */
  done: Record<SetupStep, boolean>;
  /** First step that still needs work ("review" when everything is ready). */
  next: SetupStep;
  /** True when the event can go live. */
  ready: boolean;
}

export function setupProgress(c: SetupCounts): SetupProgress {
  const hasItems = c.itemCount > 0;
  const hasPeople = c.teamCount > 0 && c.supervisorCount > 0;
  const allAssigned = hasItems && c.unassignedCount === 0;
  const done: Record<SetupStep, boolean> = {
    details: true,
    items: hasItems,
    // Warehouse scope always has a valid value once items exist (null = all warehouses).
    warehouses: hasItems,
    people: hasPeople,
    bins: allAssigned && c.teamCount > 0,
    review: false,
  };
  const ready = hasItems && hasPeople && allAssigned;
  const next: SetupStep = !hasItems ? "items" : !hasPeople ? "people" : !allAssigned ? "bins" : "review";
  return { done, next, ready };
}
