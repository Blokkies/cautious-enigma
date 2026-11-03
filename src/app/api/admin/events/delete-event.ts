import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  stocktakeEvents, items, teams, supervisors,
  teamAssignments, counts, queries, queryMessages,
  breakdowns, breakdownMessages, verificationAssignments,
  auditLog, serialDiscrepancies, execMessages,
} from "@/lib/db/schema";
import { countInt } from "@/lib/db/aggregates";
import { lockEventRow, RouteError, routeErrorResponse } from "../event-lock";

export const CLOSED_EVENT_DELETE_MSG =
  "This stocktake is completed or locked and has recorded counts. Count data cannot be deleted. Reopen the event first if it really must be removed.";

/**
 * Delete an event and all associated data (shared by DELETE /api/admin/events and
 * DELETE /api/admin/activate). Mirrors checkEventWritable(..., deletesCounts=true):
 * an event that is completed or locked and has counts is refused (403), since deleting
 * it would destroy the final count data. Setup/active events — and closed events with
 * no counts — can be deleted. The status is checked under a row lock.
 */
export async function deleteEventCascade(eventId: number): Promise<NextResponse> {
  try {
    await db.transaction(async (tx) => {
      const event = await lockEventRow(tx, eventId);
      if (!event) throw new RouteError(404, { error: "Event not found" });

      if (event.status === "completed" || event.status === "locked") {
        const [row] = await tx.select({ count: countInt() }).from(counts).where(eq(counts.eventId, eventId));
        if ((row?.count || 0) > 0) throw new RouteError(403, { error: CLOSED_EVENT_DELETE_MSG });
      }

      // 1. Messages (use subquery to avoid N+1)
      await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eventId})`);
      await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eventId})`);
      await tx.delete(execMessages).where(eq(execMessages.eventId, eventId));

      // 2. Verification assignments, counts, queries, breakdowns, serial discrepancies
      await tx.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eventId));
      await tx.delete(counts).where(eq(counts.eventId, eventId));
      await tx.delete(queries).where(eq(queries.eventId, eventId));
      await tx.delete(breakdowns).where(eq(breakdowns.eventId, eventId));
      await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eventId));

      // 3. Team assignments, audit log
      await tx.delete(teamAssignments).where(eq(teamAssignments.eventId, eventId));
      await tx.delete(auditLog).where(eq(auditLog.eventId, eventId));

      // 4. Items
      await tx.delete(items).where(eq(items.eventId, eventId));

      // 5. Supervisors and teams (exec_messages refs supervisors, already deleted above)
      await tx.delete(supervisors).where(eq(supervisors.eventId, eventId));
      await tx.delete(teams).where(eq(teams.eventId, eventId));

      // 6. Clear upload_id reference, then delete the event
      await tx.update(stocktakeEvents).set({ uploadId: null }).where(eq(stocktakeEvents.id, eventId));
      await tx.delete(stocktakeEvents).where(eq(stocktakeEvents.id, eventId));
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Delete event error:", error);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
