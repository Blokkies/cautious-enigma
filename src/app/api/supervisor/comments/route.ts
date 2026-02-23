import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams } from "@/lib/db/schema";
import { eq, and, sql, isNotNull, inArray } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "auditor" && user.type !== "executive")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let eventId = user.eventId;
  if (user.type === "executive" && user.eventId === 0) {
    const paramEventId = request.nextUrl.searchParams.get("eventId");
    if (paramEventId) eventId = Number(paramEventId);
  }
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const warehouses = await getEventWarehouses(eventId);

  try {
    const rows = await db
      .select({
        countId: counts.id,
        itemCode: items.itemCode,
        description: items.description,
        brand: items.brand,
        binNumber: items.binNumber,
        onHand: items.onHand,
        avgCost: items.avgCost,
        countedQty: counts.countedQty,
        variance: counts.variance,
        varianceValue: counts.varianceValue,
        isMatch: counts.isMatch,
        checkStatus: counts.checkStatus,
        comment: counts.comment,
        commentStatus: counts.commentStatus,
        countedAt: counts.countedAt,
        teamId: counts.teamId,
        teamName: teams.name,
        serialNumber: items.serialNumber,
        isSerialized: items.isSerialized,
        stockStatus: items.stockStatus,
      })
      .from(counts)
      .innerJoin(items, eq(counts.itemId, items.id))
      .innerJoin(teams, eq(counts.teamId, teams.id))
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.countType, "initial"),
          isNotNull(counts.comment),
          sql`${counts.comment} != ''`,
          warehouseFilter(warehouses),
        )
      )
      .orderBy(sql`${counts.countedAt} DESC`);

    return NextResponse.json({ comments: rows });
  } catch {
    return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
  }
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
    const { action, countId, countIds } = body as {
      action: string;
      countId?: number;
      countIds?: number[];
    };

    if (action === "review_comment") {
      if (!countId) {
        return NextResponse.json({ error: "countId is required" }, { status: 400 });
      }

      // Validate count belongs to supervisor's event
      const [row] = await db
        .select({ id: counts.id })
        .from(counts)
        .where(and(eq(counts.id, countId), eq(counts.eventId, user.eventId)));

      if (!row) {
        return NextResponse.json({ error: "Count not found" }, { status: 404 });
      }

      await db
        .update(counts)
        .set({ commentStatus: "reviewed" })
        .where(eq(counts.id, countId));

      return NextResponse.json({ success: true });
    }

    if (action === "bulk_review_comments") {
      if (!countIds || !Array.isArray(countIds) || countIds.length === 0) {
        return NextResponse.json({ error: "countIds array is required" }, { status: 400 });
      }

      // Validate all counts belong to supervisor's event
      const validRows = await db
        .select({ id: counts.id })
        .from(counts)
        .where(and(inArray(counts.id, countIds), eq(counts.eventId, user.eventId)));

      const validIds = validRows.map((r) => r.id);
      if (validIds.length === 0) {
        return NextResponse.json({ error: "No valid counts found" }, { status: 404 });
      }

      await db
        .update(counts)
        .set({ commentStatus: "reviewed" })
        .where(inArray(counts.id, validIds));

      return NextResponse.json({ success: true, reviewedCount: validIds.length });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Failed to update comment status" }, { status: 500 });
  }
}
