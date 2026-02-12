import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serialDiscrepancies, teams, items, counts, auditLog } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    })
    .from(serialDiscrepancies)
    .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
    .where(eq(serialDiscrepancies.eventId, user.eventId))
    .orderBy(desc(serialDiscrepancies.createdAt));

  // Enrich each discrepancy with expected serial info
  const enriched = await Promise.all(allDiscrepancies.map(async (disc) => {
    // Find expected serialized items matching itemCode + binNumber in this event
    const expectedItems = await db
      .select({
        id: items.id,
        serialNumber: items.serialNumber,
      })
      .from(items)
      .where(
        and(
          eq(items.eventId, user.eventId),
          eq(items.itemCode, disc.itemCode),
          eq(items.isSerialized, true),
          ...(disc.binNumber ? [eq(items.binNumber, disc.binNumber)] : [])
        )
      );

    // Check count status for each expected serial
    const expectedSerials = await Promise.all(expectedItems.map(async (item) => {
      const [count] = await db
        .select({ id: counts.id, countedQty: counts.countedQty })
        .from(counts)
        .where(and(eq(counts.itemId, item.id), eq(counts.eventId, user.eventId)));

      let status: "found" | "not_found" | "uncounted";
      if (!count) {
        status = "uncounted";
      } else if (count.countedQty > 0) {
        status = "found";
      } else {
        status = "not_found";
      }

      return {
        itemId: item.id,
        serialNumber: item.serialNumber,
        status,
      };
    }));

    return {
      id: disc.id,
      itemCode: disc.itemCode,
      description: disc.description,
      binNumber: disc.binNumber,
      unknownSerials: JSON.parse(disc.unknownSerials) as string[],
      expectedSerials,
      status: disc.status,
      resolution: disc.resolution,
      resolvedAt: disc.resolvedAt,
      createdAt: disc.createdAt,
      teamName: disc.teamName,
      teamId: disc.teamId,
    };
  }));

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
    const { resolution } = body;

    await db.update(serialDiscrepancies)
      .set({
        status: "resolved",
        resolution: resolution || null,
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
