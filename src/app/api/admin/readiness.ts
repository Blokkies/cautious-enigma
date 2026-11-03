import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, supervisors, teams } from "@/lib/db/schema";
import { countInt } from "@/lib/db/aggregates";
import { warehouseFilter } from "@/lib/api-auth";
import type { Tx } from "./event-lock";

export interface ActivationReadiness {
  hasItems: boolean;
  hasTeams: boolean;
  hasSupervisors: boolean;
  allItemsAssigned: boolean;
  /** Items in the event's warehouse scope. */
  itemCount: number;
  teamCount: number;
  supervisorCount: number;
  /** In-scope items with no team. */
  unassignedCount: number;
}

/**
 * Activation readiness, scoped to the event's selected warehouses (the same scope the
 * assignment page and the counting screens use). `warehouses` null = all warehouses.
 */
export async function getActivationReadiness(
  exec: typeof db | Tx,
  eventId: number,
  warehouses: string[] | null
): Promise<ActivationReadiness> {
  const scope = warehouseFilter(warehouses);
  const [[itemRow], [teamRow], [supervisorRow], [unassignedRow]] = await Promise.all([
    exec.select({ count: countInt() }).from(items).where(and(eq(items.eventId, eventId), scope)),
    exec.select({ count: countInt() }).from(teams).where(eq(teams.eventId, eventId)),
    exec.select({ count: countInt() }).from(supervisors).where(eq(supervisors.eventId, eventId)),
    exec.select({ count: countInt() }).from(items).where(and(eq(items.eventId, eventId), isNull(items.teamId), scope)),
  ]);
  const itemCount = itemRow?.count || 0;
  const teamCount = teamRow?.count || 0;
  const supervisorCount = supervisorRow?.count || 0;
  const unassignedCount = unassignedRow?.count || 0;
  return {
    hasItems: itemCount > 0,
    hasTeams: teamCount > 0,
    hasSupervisors: supervisorCount > 0,
    allItemsAssigned: unassignedCount === 0,
    itemCount,
    teamCount,
    supervisorCount,
    unassignedCount,
  };
}

/** Why the event can't be activated yet, or null if it is ready. */
export function activationBlocker(
  r: Pick<ActivationReadiness, "itemCount" | "teamCount" | "supervisorCount" | "unassignedCount">
): string | null {
  if (r.itemCount === 0) {
    return "Cannot activate: the event has no items in its selected warehouses. Import stock data first.";
  }
  if (r.teamCount === 0) {
    return "Cannot activate: the event has no counting teams. Create at least one team first.";
  }
  if (r.supervisorCount === 0) {
    return "Cannot activate: the event has no supervisors. Add at least one supervisor first.";
  }
  if (r.unassignedCount > 0) {
    return `Cannot activate: ${r.unassignedCount} item${r.unassignedCount === 1 ? " is" : "s are"} not assigned to a team. Assign all bins first.`;
  }
  return null;
}
