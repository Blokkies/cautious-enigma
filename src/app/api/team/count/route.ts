import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, auditLog } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { itemId, countedQty, isMatch, comment, clientId } = body;

    if (itemId === undefined || countedQty === undefined) {
      return NextResponse.json(
        { error: "itemId and countedQty are required" },
        { status: 400 }
      );
    }

    // Verify item belongs to this team
    const item = db
      .select()
      .from(items)
      .where(
        and(
          eq(items.id, itemId),
          eq(items.teamId, user.id),
          eq(items.eventId, user.eventId)
        )
      )
      .get();

    if (!item) {
      return NextResponse.json(
        { error: "Item not found or not assigned to your team" },
        { status: 404 }
      );
    }

    // Check for duplicate sync (clientId dedup)
    if (clientId) {
      const existing = db
        .select()
        .from(counts)
        .where(eq(counts.clientId, clientId))
        .get();

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

    // Check if already counted - update if so
    const existingCount = db
      .select()
      .from(counts)
      .where(
        and(eq(counts.itemId, itemId), eq(counts.teamId, user.id))
      )
      .get();

    let result;

    if (existingCount) {
      // Update existing count
      db.update(counts)
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
        .where(eq(counts.id, existingCount.id))
        .run();

      result = db
        .select()
        .from(counts)
        .where(eq(counts.id, existingCount.id))
        .get();

      // Audit log
      db.insert(auditLog)
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
        })
        .run();
    } else {
      // Insert new count
      const insertResult = db
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
        .run();

      result = db
        .select()
        .from(counts)
        .where(eq(counts.id, Number(insertResult.lastInsertRowid)))
        .get();

      // Audit log
      db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "team",
          action: "create_count",
          tableName: "counts",
          recordId: Number(insertResult.lastInsertRowid),
          newValue: JSON.stringify({ countedQty, variance, isMatch }),
        })
        .run();
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
        const existing = db
          .select()
          .from(counts)
          .where(eq(counts.clientId, clientId))
          .get();

        if (existing) {
          results.push({ itemId, deduplicated: true });
          continue;
        }
      }

      const item = db
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.teamId, user.id),
            eq(items.eventId, user.eventId)
          )
        )
        .get();

      if (!item) {
        results.push({ itemId, error: "Not found" });
        continue;
      }

      const variance = countedQty - (item.onHand || 0);
      const varianceValue = variance * (item.avgCost || 0);

      const existingCount = db
        .select()
        .from(counts)
        .where(
          and(eq(counts.itemId, itemId), eq(counts.teamId, user.id))
        )
        .get();

      if (existingCount) {
        db.update(counts)
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
          .where(eq(counts.id, existingCount.id))
          .run();
      } else {
        db.insert(counts)
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
          .run();
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
