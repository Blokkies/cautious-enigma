import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams } from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";

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
