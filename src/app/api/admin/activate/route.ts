import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors, counts, queries, queryMessages, breakdowns, breakdownMessages, teamAssignments, auditLog, verificationAssignments, serialDiscrepancies, execMessages } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getEventWarehouses, requireUser } from "@/lib/api-auth";
import { checkEventWritable } from "../event-guard";
import { ACTIVATE_PUT_TARGETS, canActivate, checkActivatePutTransition } from "@/lib/event-status";
import { lockEventRow, parseEventWarehouses, RouteError, routeErrorResponse } from "../event-lock";
import { activationBlocker, getActivationReadiness } from "../readiness";
import { deleteEventCascade } from "../events/delete-event";

// GET: Check readiness (scoped to the event's selected warehouses)
export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"] });
  if (auth.response) return auth.response;

  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);
  const readiness = await getActivationReadiness(db, eid, await getEventWarehouses(eid));

  return NextResponse.json({
    hasItems: readiness.hasItems,
    hasTeams: readiness.hasTeams,
    hasSupervisors: readiness.hasSupervisors,
    allItemsAssigned: readiness.allItemsAssigned,
    unassignedCount: readiness.unassignedCount,
    blocker: activationBlocker(readiness),
  });
}

// POST: Activate event
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

  try {
    const { eventId } = await request.json();
    const eid = Number(eventId);

    await db.transaction(async (tx) => {
      // Lock the event row: a concurrent import/copy/reset holds the same lock, so the
      // readiness check below sees a consistent item/assignment state.
      const event = await lockEventRow(tx, eid);
      if (!event) throw new RouteError(404, { error: "Event not found" });
      if (!canActivate(event.status)) {
        throw new RouteError(409, { error: `Event is not in setup phase (status: ${event.status})` });
      }

      const readiness = await getActivationReadiness(tx, eid, parseEventWarehouses(event.warehouses));
      const blocker = activationBlocker(readiness);
      if (blocker) {
        throw new RouteError(400, {
          error: blocker,
          readiness: {
            itemCount: readiness.itemCount,
            teamCount: readiness.teamCount,
            unassignedCount: readiness.unassignedCount,
          },
        });
      }

      // Conditional update: only a setup event becomes active
      const updated = await tx.update(stocktakeEvents)
        .set({ status: "active", updatedAt: new Date().toISOString() })
        .where(and(eq(stocktakeEvents.id, eid), eq(stocktakeEvents.status, "setup")))
        .returning({ id: stocktakeEvents.id });
      if (updated.length === 0) {
        throw new RouteError(409, { error: "Event status changed while activating. Reload and try again." });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Activate error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Change status (complete/lock/setup) or reset stocktake
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

  try {
    const { eventId, status, action } = await request.json();
    const eid = Number(eventId);

    // Full reset: delete all operational data but keep imported items and event
    if (action === "reset") {
      // Reset deletes counts: never allowed on a completed/locked event.
      const guardError = await checkEventWritable(eid, "admin", true);
      if (guardError) {
        return NextResponse.json(
          { error: guardError },
          { status: guardError === "Event not found" ? 404 : 403 }
        );
      }
      await db.transaction(async (tx) => {
        // Re-check under a row lock: the event may have been completed meanwhile
        const locked = await lockEventRow(tx, eid);
        if (!locked) throw new RouteError(404, { error: "Event not found" });
        const recheck = locked.status === "completed" || locked.status === "locked";
        if (recheck) {
          throw new RouteError(403, { error: "This stocktake is completed or locked. Count data cannot be deleted." });
        }
        // Delete operational data in correct order (children first)
        await tx.delete(execMessages).where(eq(execMessages.eventId, eid));
        await tx.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eid));
        await tx.delete(auditLog).where(eq(auditLog.eventId, eid));
        await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eid));
        await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eid})`);
        await tx.delete(breakdowns).where(eq(breakdowns.eventId, eid));
        await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eid})`);
        await tx.delete(queries).where(eq(queries.eventId, eid));
        await tx.delete(counts).where(eq(counts.eventId, eid));
        await tx.delete(teamAssignments).where(eq(teamAssignments.eventId, eid));
        // Clear bin assignments but keep items
        await tx.update(items).set({ teamId: null }).where(eq(items.eventId, eid));
        // Delete teams and supervisors
        await tx.delete(supervisors).where(eq(supervisors.eventId, eid));
        await tx.delete(teams).where(eq(teams.eventId, eid));
        // Reset status to setup
        await tx.update(stocktakeEvents)
          .set({ status: "setup", updatedAt: new Date().toISOString() })
          .where(eq(stocktakeEvents.id, eid));
      });

      return NextResponse.json({ success: true });
    }

    if (!ACTIVATE_PUT_TARGETS.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const [existing] = await db
      .select({ status: stocktakeEvents.status })
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, eid));
    if (!existing) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    // Allowed: active -> setup (cancel), active -> completed, completed -> locked
    const transition = checkActivatePutTransition(existing.status, status);
    if (!transition.ok) {
      return NextResponse.json({ error: transition.error }, { status: 400 });
    }

    // Conditional on the status we validated, so a concurrent change isn't overwritten
    const updated = await db.update(stocktakeEvents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(and(eq(stocktakeEvents.id, eid), eq(stocktakeEvents.status, existing.status)))
      .returning({ id: stocktakeEvents.id });
    if (updated.length === 0) {
      return NextResponse.json({ error: "Event status changed meanwhile. Reload and try again." }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Status update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: Delete an event and all associated data
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

  try {
    const { eventId } = await request.json();
    return await deleteEventCascade(Number(eventId));
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
