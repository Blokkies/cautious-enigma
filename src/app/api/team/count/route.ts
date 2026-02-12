import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, auditLog, verificationAssignments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { itemId, countedQty, isMatch, comment, clientId, verificationId } = body;

    if (itemId === undefined || countedQty === undefined) {
      return NextResponse.json(
        { error: "itemId and countedQty are required" },
        { status: 400 }
      );
    }

    // Handle verification count submission
    if (verificationId) {
      const [va] = await db
        .select()
        .from(verificationAssignments)
        .where(
          and(
            eq(verificationAssignments.id, verificationId),
            eq(verificationAssignments.assignedTeamId, user.id),
            eq(verificationAssignments.eventId, user.eventId),
            eq(verificationAssignments.status, "pending")
          )
        );

      if (!va) {
        return NextResponse.json(
          { error: "Verification assignment not found or not assigned to your team" },
          { status: 404 }
        );
      }

      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.id, itemId));

      if (!item) {
        return NextResponse.json(
          { error: "Item not found" },
          { status: 404 }
        );
      }

      const variance = countedQty - (item.onHand || 0);
      const varianceValue = variance * (item.avgCost || 0);
      const computedIsMatch = variance === 0;

      // Insert a new verification count (never upsert)
      const [{ id: insertedId }] = await db
        .insert(counts)
        .values({
          itemId,
          teamId: user.id,
          eventId: user.eventId,
          countedQty,
          variance,
          varianceValue,
          isMatch: computedIsMatch,
          comment: comment || null,
          countedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString(),
          clientId: clientId || null,
          countType: "verification",
          verificationId,
        })
        .returning({ id: counts.id });

      // Update verification assignment status
      await db.update(verificationAssignments)
        .set({
          status: "completed",
          completedAt: new Date().toISOString(),
        })
        .where(eq(verificationAssignments.id, verificationId));

      const [result] = await db
        .select()
        .from(counts)
        .where(eq(counts.id, insertedId));

      // Audit log
      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "team",
          action: "verification_count",
          tableName: "counts",
          recordId: insertedId,
          newValue: JSON.stringify({
            countedQty,
            variance,
            verificationId,
          }),
        });

      return NextResponse.json({ success: true, count: result });
    }

    // Verify item belongs to this team
    const [item] = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.id, itemId),
          eq(items.teamId, user.id),
          eq(items.eventId, user.eventId)
        )
      );

    if (!item) {
      return NextResponse.json(
        { error: "Item not found or not assigned to your team" },
        { status: 404 }
      );
    }

    // Check for duplicate sync (clientId dedup)
    if (clientId) {
      const [existing] = await db
        .select()
        .from(counts)
        .where(eq(counts.clientId, clientId));

      if (existing) {
        return NextResponse.json({
          success: true,
          count: existing,
          deduplicated: true,
        });
      }
    }

    const variance = countedQty - (item.onHand || 0);
    const varianceValue = variance * (item.avgCost || 0);

    // Check if already counted (initial counts only) - update if so
    const [existingCount] = await db
      .select()
      .from(counts)
      .where(
        and(
          eq(counts.itemId, itemId),
          eq(counts.teamId, user.id),
          eq(counts.countType, "initial")
        )
      );

    let result;

    if (existingCount) {
      // Update existing count
      await db.update(counts)
        .set({
          countedQty,
          variance,
          varianceValue,
          isMatch: isMatch || false,
          comment: comment || existingCount.comment,
          countedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString(),
          clientId: clientId || existingCount.clientId,
        })
        .where(eq(counts.id, existingCount.id));

      const [updated] = await db
        .select()
        .from(counts)
        .where(eq(counts.id, existingCount.id));
      result = updated;

      // Audit log
      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "team",
          action: "update_count",
          tableName: "counts",
          recordId: existingCount.id,
          oldValue: JSON.stringify({
            countedQty: existingCount.countedQty,
            variance: existingCount.variance,
          }),
          newValue: JSON.stringify({ countedQty, variance }),
        });
    } else {
      // Insert new count
      const [{ id: insertedId }] = await db
        .insert(counts)
        .values({
          itemId,
          teamId: user.id,
          eventId: user.eventId,
          countedQty,
          variance,
          varianceValue,
          isMatch: isMatch || false,
          comment: comment || null,
          countedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString(),
          clientId: clientId || null,
        })
        .returning({ id: counts.id });

      const [inserted] = await db
        .select()
        .from(counts)
        .where(eq(counts.id, insertedId));
      result = inserted;

      // Audit log
      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "team",
          action: "create_count",
          tableName: "counts",
          recordId: insertedId,
          newValue: JSON.stringify({ countedQty, variance, isMatch }),
        });
    }

    return NextResponse.json({ success: true, count: result });
  } catch (error) {
    console.error("Count error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Batch sync endpoint
export async function PUT(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { counts: countBatch } = await request.json();

    if (!Array.isArray(countBatch)) {
      return NextResponse.json(
        { error: "counts must be an array" },
        { status: 400 }
      );
    }

    const results = [];

    for (const entry of countBatch) {
      const { itemId, countedQty, isMatch, comment, clientId } = entry;

      // Dedup check
      if (clientId) {
        const [existing] = await db
          .select()
          .from(counts)
          .where(eq(counts.clientId, clientId));

        if (existing) {
          results.push({ itemId, deduplicated: true });
          continue;
        }
      }

      const [item] = await db
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.teamId, user.id),
            eq(items.eventId, user.eventId)
          )
        );

      if (!item) {
        results.push({ itemId, error: "Not found" });
        continue;
      }

      const variance = countedQty - (item.onHand || 0);
      const varianceValue = variance * (item.avgCost || 0);

      const [existingCount] = await db
        .select()
        .from(counts)
        .where(
          and(
            eq(counts.itemId, itemId),
            eq(counts.teamId, user.id),
            eq(counts.countType, "initial")
          )
        );

      if (existingCount) {
        await db.update(counts)
          .set({
            countedQty,
            variance,
            varianceValue,
            isMatch: isMatch || false,
            comment: comment || existingCount.comment,
            countedAt: new Date().toISOString(),
            syncedAt: new Date().toISOString(),
            clientId: clientId || existingCount.clientId,
          })
          .where(eq(counts.id, existingCount.id));
      } else {
        await db.insert(counts)
          .values({
            itemId,
            teamId: user.id,
            eventId: user.eventId,
            countedQty,
            variance,
            varianceValue,
            isMatch: isMatch || false,
            comment: comment || null,
            countedAt: new Date().toISOString(),
            syncedAt: new Date().toISOString(),
            clientId: clientId || null,
          });
      }

      results.push({ itemId, success: true });
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Batch sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
