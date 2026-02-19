import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serialDiscrepancies, teams, items, counts, auditLog } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getApiUser, checkEventActive, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";

function safeJsonParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "auditor" && user.type !== "executive")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const warehouses = await getEventWarehouses(user.eventId);

  const allDiscrepancies = await db
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
    .where(eq(serialDiscrepancies.eventId, user.eventId))
    .orderBy(desc(serialDiscrepancies.createdAt));

  // Batch-fetch all serialized items for this event (avoids N+1 per discrepancy)
  const allSerializedItems = await db
    .select({ id: items.id, itemCode: items.itemCode, binNumber: items.binNumber, serialNumber: items.serialNumber })
    .from(items)
    .where(and(eq(items.eventId, user.eventId), eq(items.isSerialized, true), warehouseFilter(warehouses)));

  // Batch-fetch all counts for serialized items
  const serializedItemIds = allSerializedItems.map((i) => i.id);
  const allSerialCounts = serializedItemIds.length > 0
    ? await db
        .select({ itemId: counts.itemId, countedQty: counts.countedQty })
        .from(counts)
        .where(and(eq(counts.eventId, user.eventId), inArray(counts.itemId, serializedItemIds)))
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
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        .select({ unknownSerials: serialDiscrepancies.unknownSerials })
        .from(serialDiscrepancies)
        .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)));

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

      // Check if count already exists
      const [existingCount] = await db
        .select()
        .from(counts)
        .where(and(eq(counts.itemId, itemId), eq(counts.eventId, user.eventId)));

      if (existingCount) {
        const oldCountedQty = existingCount.countedQty;
        await db.update(counts)
          .set({
            countedQty,
            variance,
            varianceValue,
            isMatch,
            countedAt: new Date().toISOString(),
            comment: `Supervisor override: ${newStatus}`,
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
            oldValue: JSON.stringify({ countedQty: oldCountedQty, serialNumber: item.serialNumber }),
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

    await db.update(serialDiscrepancies)
      .set({
        status: "resolved",
        resolution: resolution || null,
        resolutionType: bodyResolutionType || "approved",
        resolvedBy: user.id,
        resolvedAt: new Date().toISOString(),
      })
      .where(and(eq(serialDiscrepancies.id, discrepancyId), eq(serialDiscrepancies.eventId, user.eventId)));

    await db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "supervisor",
        action: "serial_discrepancy_resolved",
        tableName: "serial_discrepancies",
        recordId: discrepancyId,
        newValue: JSON.stringify({ resolution: resolution || null }),
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Serial discrepancy action error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
