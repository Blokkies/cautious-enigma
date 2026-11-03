import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serialDiscrepancies, teams, items, counts, auditLog, verificationAssignments } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  requireUser,
  resolveEventId,
  checkEventActive,
  getEventWarehouses,
  warehouseFilter,
  filterDiscrepanciesToWarehouses,
  mergeUnknownsIntoApproved,
} from "@/lib/api-auth";
import { safeJsonParse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["supervisor", "auditor", "executive"], status: 401 });
  if (auth.response) return auth.response;
  const { user } = auth;

  // Admins/executives log in with eventId 0 and pick the event via ?eventId
  const eventId = resolveEventId(user, request.nextUrl.searchParams.get("eventId"));
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const warehouses = await getEventWarehouses(eventId);

  const eventDiscrepancies = await db
    .select({
      id: serialDiscrepancies.id,
      itemCode: serialDiscrepancies.itemCode,
      description: serialDiscrepancies.description,
      binNumber: serialDiscrepancies.binNumber,
      unknownSerials: serialDiscrepancies.unknownSerials,
      status: serialDiscrepancies.status,
      resolution: serialDiscrepancies.resolution,
      resolvedAt: serialDiscrepancies.resolvedAt,
      createdAt: serialDiscrepancies.createdAt,
      teamName: teams.name,
      teamId: serialDiscrepancies.teamId,
      verificationTeamId: serialDiscrepancies.verificationTeamId,
      verificationStatus: serialDiscrepancies.verificationStatus,
      verificationAssignedAt: serialDiscrepancies.verificationAssignedAt,
      verificationCompletedAt: serialDiscrepancies.verificationCompletedAt,
      verifiedSerials: serialDiscrepancies.verifiedSerials,
    })
    .from(serialDiscrepancies)
    .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
    .where(eq(serialDiscrepancies.eventId, eventId))
    .orderBy(desc(serialDiscrepancies.createdAt));

  // Same warehouse scoping as the variances page (by the source item's warehouse)
  const allDiscrepancies = await filterDiscrepanciesToWarehouses(eventId, eventDiscrepancies, warehouses);

  // Batch-fetch all serialized items for this event (avoids N+1 per discrepancy)
  const allSerializedItems = await db
    .select({ id: items.id, itemCode: items.itemCode, binNumber: items.binNumber, serialNumber: items.serialNumber })
    .from(items)
    .where(and(eq(items.eventId, eventId), eq(items.isSerialized, true), warehouseFilter(warehouses)));

  // Batch-fetch all counts for serialized items
  const serializedItemIds = allSerializedItems.map((i) => i.id);
  const allSerialCounts = serializedItemIds.length > 0
    ? await db
        .select({ itemId: counts.itemId, countedQty: counts.countedQty })
        .from(counts)
        .where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), inArray(counts.itemId, serializedItemIds)))
    : [];
  const countByItemId = new Map(allSerialCounts.map((c) => [c.itemId, c.countedQty]));

  // Batch-fetch all verification team names
  const vTeamIds = Array.from(new Set(allDiscrepancies.map((d) => d.verificationTeamId).filter((id): id is number => !!id)));
  const vTeams = vTeamIds.length > 0
    ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, vTeamIds))
    : [];
  const vTeamMap = new Map(vTeams.map((t) => [t.id, t.name]));

  // Enrich each discrepancy using pre-fetched data (no additional queries)
  const enriched = allDiscrepancies.map((disc) => {
    const expectedItems = allSerializedItems.filter((i) =>
      i.itemCode === disc.itemCode && (!disc.binNumber || i.binNumber === disc.binNumber)
    );

    const expectedSerials = expectedItems.map((item) => {
      const countedQty = countByItemId.get(item.id);
      let status: "found" | "not_found" | "uncounted";
      if (countedQty === undefined) {
        status = "uncounted";
      } else if (countedQty > 0) {
        status = "found";
      } else {
        status = "not_found";
      }
      return { itemId: item.id, serialNumber: item.serialNumber, status };
    });

    return {
      id: disc.id,
      itemCode: disc.itemCode,
      description: disc.description,
      binNumber: disc.binNumber,
      unknownSerials: safeJsonParse<string[]>(disc.unknownSerials, []),
      expectedSerials,
      status: disc.status,
      resolution: disc.resolution,
      resolvedAt: disc.resolvedAt,
      createdAt: disc.createdAt,
      teamName: disc.teamName,
      teamId: disc.teamId,
      verificationTeamId: disc.verificationTeamId,
      verificationTeamName: disc.verificationTeamId ? vTeamMap.get(disc.verificationTeamId) ?? null : null,
      verificationStatus: disc.verificationStatus,
      verificationAssignedAt: disc.verificationAssignedAt,
      verificationCompletedAt: disc.verificationCompletedAt,
      verifiedSerials: disc.verifiedSerials ? safeJsonParse(disc.verifiedSerials, null) : null,
    };
  });

  return NextResponse.json({ discrepancies: enriched });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["supervisor"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { discrepancyId, action } = body;

    if (!discrepancyId) {
      return NextResponse.json(
        { error: "discrepancyId is required" },
        { status: 400 }
      );
    }

    // Default to "resolve" for backwards compatibility
    const effectiveAction = action || "resolve";

    if (effectiveAction === "update-unknowns") {
      const { unknownSerials } = body as { unknownSerials: string[] };
      if (!Array.isArray(unknownSerials)) {
        return NextResponse.json(
          { error: "unknownSerials must be an array" },
          { status: 400 }
        );
      }

      // Get old value for audit
      const [oldDisc] = await db
        .select({ unknownSerials: serialDiscrepancies.unknownSerials, verificationStatus: serialDiscrepancies.verificationStatus })
        .from(serialDiscrepancies)
        .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)));

      if (!oldDisc) {
        return NextResponse.json({ error: "Discrepancy not found" }, { status: 404 });
      }
      // Same rule as the variances page: unknowns are frozen while a team verifies them
      if (oldDisc.verificationStatus === "pending") {
        return NextResponse.json(
          { error: "Cannot modify serials while verification is in progress" },
          { status: 409 }
        );
      }

      await db.update(serialDiscrepancies)
        .set({ unknownSerials: JSON.stringify(unknownSerials) })
        .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)));

      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: "serial_update_unknowns",
          tableName: "serial_discrepancies",
          recordId: discrepancyId,
          oldValue: oldDisc?.unknownSerials ?? null,
          newValue: JSON.stringify(unknownSerials),
        });

      return NextResponse.json({ success: true });
    }

    if (effectiveAction === "override-expected") {
      const { itemId, newStatus } = body as {
        itemId: number;
        newStatus: "found" | "not_found";
      };

      if (!itemId || !["found", "not_found"].includes(newStatus)) {
        return NextResponse.json(
          { error: "itemId and newStatus (found/not_found) are required" },
          { status: 400 }
        );
      }

      // Look up the item to get onHand and avgCost for variance calc
      const [item] = await db
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.eventId, user.eventId)));

      if (!item) {
        return NextResponse.json(
          { error: "Item not found" },
          { status: 404 }
        );
      }

      const countedQty = newStatus === "found" ? 1 : 0;
      const onHand = item.onHand ?? 0;
      const variance = countedQty - onHand;
      const varianceValue = variance * (item.avgCost ?? 0);
      const isMatch = variance === 0;

      // Check if initial count already exists
      const [existingCount] = await db
        .select()
        .from(counts)
        .where(and(eq(counts.itemId, itemId), eq(counts.eventId, user.eventId), eq(counts.countType, "initial")));

      if (existingCount) {
        // Don't rewrite a count the supervisor already settled, or one a
        // verification team is recounting (its result would then compete).
        if (existingCount.checkStatus === "accepted") {
          return NextResponse.json(
            { error: "This count has already been accepted. Reopen it on the variances page before overriding." },
            { status: 409 }
          );
        }
        const [pendingVerification] = await db
          .select({ id: verificationAssignments.id })
          .from(verificationAssignments)
          .where(
            and(
              eq(verificationAssignments.countId, existingCount.id),
              eq(verificationAssignments.eventId, user.eventId),
              eq(verificationAssignments.status, "pending")
            )
          );
        if (pendingVerification) {
          return NextResponse.json(
            { error: "A recount is pending for this item. Wait for the verification team to submit before overriding." },
            { status: 409 }
          );
        }

        const oldCountedQty = existingCount.countedQty;
        // Keep the team's comment; append the supervisor note
        const note = `Supervisor override: ${newStatus}`;
        const comment = existingCount.comment?.trim() ? `${existingCount.comment.trim()}
${note}` : note;
        await db.update(counts)
          .set({
            countedQty,
            variance,
            varianceValue,
            isMatch,
            countedAt: new Date().toISOString(),
            comment,
          })
          .where(eq(counts.id, existingCount.id));

        await db.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "supervisor",
            action: "serial_override_expected",
            tableName: "counts",
            recordId: existingCount.id,
            oldValue: JSON.stringify({ countedQty: oldCountedQty, serialNumber: item.serialNumber, comment: existingCount.comment }),
            newValue: JSON.stringify({ countedQty, newStatus, serialNumber: item.serialNumber }),
          });
      } else {
        // Insert new count using the item's teamId
        const teamId = item.teamId;
        if (!teamId) {
          return NextResponse.json(
            { error: "Item has no team assignment" },
            { status: 400 }
          );
        }

        const [{ id }] = await db.insert(counts)
          .values({
            itemId,
            teamId,
            eventId: user.eventId,
            countedQty,
            variance,
            varianceValue,
            isMatch,
            comment: `Supervisor override: ${newStatus}`,
            countedAt: new Date().toISOString(),
          })
          .returning({ id: counts.id });

        await db.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "supervisor",
            action: "serial_override_expected",
            tableName: "counts",
            recordId: id,
            newValue: JSON.stringify({ countedQty, newStatus, serialNumber: item.serialNumber }),
          });
      }

      return NextResponse.json({ success: true });
    }

    if (effectiveAction === "assign-verification") {
      const { assignedTeamId } = body as { assignedTeamId: number };
      if (!assignedTeamId) {
        return NextResponse.json(
          { error: "assignedTeamId is required" },
          { status: 400 }
        );
      }

      // Validate discrepancy exists, belongs to event, and is open
      const [disc] = await db
        .select()
        .from(serialDiscrepancies)
        .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)));

      if (!disc) {
        return NextResponse.json({ error: "Discrepancy not found" }, { status: 404 });
      }

      if (disc.status !== "open") {
        return NextResponse.json({ error: "Discrepancy is not open" }, { status: 400 });
      }

      // Prevent duplicate pending assignment
      if (disc.verificationStatus === "pending") {
        return NextResponse.json(
          { error: "Verification already pending for this discrepancy" },
          { status: 409 }
        );
      }

      // Validate team belongs to event
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, assignedTeamId), eq(teams.eventId, user.eventId)));

      if (!team) {
        return NextResponse.json({ error: "Team not found in this event" }, { status: 404 });
      }

      // Set verification fields (allow re-assignment after completion)
      await db.update(serialDiscrepancies)
        .set({
          verificationTeamId: assignedTeamId,
          verificationAssignedBy: user.id,
          verificationAssignedAt: new Date().toISOString(),
          verificationStatus: "pending",
          verificationCompletedAt: null,
          verifiedSerials: null,
        })
        .where(eq(serialDiscrepancies.id, discrepancyId));

      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: "serial_assign_verification",
          tableName: "serial_discrepancies",
          recordId: discrepancyId,
          newValue: JSON.stringify({ assignedTeamId }),
        });

      return NextResponse.json({ success: true });
    }

    if (effectiveAction === "reopen") {
      await db.update(serialDiscrepancies)
        .set({
          status: "open",
          resolution: null,
          resolvedBy: null,
          resolvedAt: null,
        })
        .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)));

      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: "serial_discrepancy_reopened",
          tableName: "serial_discrepancies",
          recordId: discrepancyId,
        });

      return NextResponse.json({ success: true });
    }

    // Default: resolve
    const { resolution, resolutionType: bodyResolutionType } = body;

    const resolutionType: string = bodyResolutionType || "approved";

    class ResolveError extends Error {
      constructor(message: string, public status: number) { super(message); }
    }

    try {
      await db.transaction(async (tx) => {
        const [disc] = await tx
          .select({
            verificationStatus: serialDiscrepancies.verificationStatus,
            unknownSerials: serialDiscrepancies.unknownSerials,
            approvedSerials: serialDiscrepancies.approvedSerials,
          })
          .from(serialDiscrepancies)
          .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)))
          .for("update");

        if (!disc) throw new ResolveError("Discrepancy not found", 404);
        // Block resolve while a verification team is still working
        if (disc.verificationStatus === "pending") {
          throw new ResolveError("Cannot resolve while verification is in progress", 409);
        }

        // Approving keeps the surplus: move the unknowns into approvedSerials,
        // like approving them one by one on the variances page. Once resolved,
        // leftover unknowns no longer count (getCountableDiscrepancySerials).
        const serialUpdates = resolutionType === "approved"
          ? mergeUnknownsIntoApproved(disc.unknownSerials, disc.approvedSerials)
          : {};

        await tx.update(serialDiscrepancies)
          .set({
            ...serialUpdates,
            status: "resolved",
            resolution: resolution || null,
            resolutionType,
            resolvedBy: user.id,
            resolvedAt: new Date().toISOString(),
          })
          .where(eq(serialDiscrepancies.id, discrepancyId));

        await tx.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "supervisor",
            action: "serial_discrepancy_resolved",
            tableName: "serial_discrepancies",
            recordId: discrepancyId,
            oldValue: JSON.stringify({ unknownSerials: disc.unknownSerials, approvedSerials: disc.approvedSerials }),
            newValue: JSON.stringify({ resolution: resolution || null, resolutionType, ...serialUpdates }),
          });
      });
    } catch (err) {
      if (err instanceof ResolveError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Serial discrepancy action error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
