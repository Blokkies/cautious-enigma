import { db } from "@/lib/db";
import { stocktakeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Guard for team/assignment write operations.
 * - Non-admin callers (supervisors) may only write while the event is in setup or active.
 * - Operations that delete counts are blocked for everyone on completed/locked events.
 * Returns null if allowed, or an error message (respond with 403).
 */
export async function checkEventWritable(
  eventId: number,
  userType: string,
  deletesCounts = false
): Promise<string | null> {
  const [event] = await db
    .select({ status: stocktakeEvents.status })
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eventId));

  if (!event) return "Event not found";
  const closed = event.status === "completed" || event.status === "locked";
  if (deletesCounts && closed) {
    return "This stocktake is completed or locked. Count data cannot be deleted.";
  }
  if (userType !== "admin" && event.status !== "setup" && event.status !== "active") {
    return "This stocktake is completed or locked. No further changes are allowed.";
  }
  return null;
}
