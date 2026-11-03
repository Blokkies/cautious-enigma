// Where an event is in the setup wizard, derived from server counts. Pure: usable on server and client.

import { SETUP_STEPS, type SetupStep } from "./admin-routes";
import { formatNumber } from "./format";

const SETUP_STEP_ORDER: readonly SetupStep[] = SETUP_STEPS;

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

/** True when the warehouses step has nothing to choose (one warehouse or none). */
export function skipsWarehouses(warehouseCount: number): boolean {
  return warehouseCount <= 1;
}

/**
 * Can the user open `step` from the stepper? Steps up to the first unfinished one are
 * reachable, and so is any step whose requirement is already met.
 */
export function isStepReachable(step: SetupStep, progress: SetupProgress): boolean {
  if (step === "details" || progress.done[step]) return true;
  return SETUP_STEP_ORDER.indexOf(step) <= SETUP_STEP_ORDER.indexOf(progress.next);
}

/** Why Continue is disabled on `step`, or null when the user may move on. */
export function continueBlocker(step: SetupStep, c: SetupCounts): string | null {
  switch (step) {
    case "items":
    case "warehouses":
      return c.itemCount > 0 ? null : "Import a stock file (or copy items from another stocktake) to continue.";
    case "people":
      if (c.teamCount === 0 && c.supervisorCount === 0) return "Add at least one team and one supervisor to continue.";
      if (c.teamCount === 0) return "Add at least one counting team to continue.";
      if (c.supervisorCount === 0) return "Add at least one supervisor to continue.";
      return null;
    case "bins":
      if (c.teamCount === 0) return "Add a team on the People step first, so there is someone to assign bins to.";
      if (c.itemCount === 0) return "Import a stock file first.";
      if (c.unassignedCount > 0) {
        return `${formatNumber(c.unassignedCount)} item${c.unassignedCount === 1 ? " is" : "s are"} still unassigned. Assign every bin to continue.`;
      }
      return null;
    default:
      return null;
  }
}

/** The step after `step` (skipping warehouses when there is no choice), or null after review. */
export function stepAfter(step: SetupStep, skipWarehouseStep: boolean): SetupStep | null {
  let i = SETUP_STEP_ORDER.indexOf(step) + 1;
  if (skipWarehouseStep && SETUP_STEP_ORDER[i] === "warehouses") i++;
  return SETUP_STEP_ORDER[i] ?? null;
}

/** The step before `step` (skipping warehouses when there is no choice), or null on details. */
export function stepBefore(step: SetupStep, skipWarehouseStep: boolean): SetupStep | null {
  let i = SETUP_STEP_ORDER.indexOf(step) - 1;
  if (skipWarehouseStep && SETUP_STEP_ORDER[i] === "warehouses") i--;
  return i >= 0 ? SETUP_STEP_ORDER[i] : null;
}
