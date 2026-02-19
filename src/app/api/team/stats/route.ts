import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const warehouses = await getEventWarehouses(user.eventId);

  const [totalItems] = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(
      and(eq(items.eventId, user.eventId), eq(items.teamId, user.id), warehouseFilter(warehouses))
    );

  const [countedItems] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(
      and(eq(counts.eventId, user.eventId), eq(counts.teamId, user.id), eq(counts.countType, "initial"), countsWarehouseFilter(user.eventId, warehouses))
    );

  const [matchedItems] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(
      and(
        eq(counts.eventId, user.eventId),
        eq(counts.teamId, user.id),
        eq(counts.countType, "initial"),
        eq(counts.isMatch, true),
        countsWarehouseFilter(user.eventId, warehouses)
      )
    );

  const [varianceItems] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(
      and(
        eq(counts.eventId, user.eventId),
        eq(counts.teamId, user.id),
        eq(counts.countType, "initial"),
        eq(counts.isMatch, false),
        countsWarehouseFilter(user.eventId, warehouses)
      )
    );

  const total = totalItems?.count || 0;
  const counted = countedItems?.count || 0;
  const matched = matchedItems?.count || 0;
  const withVariance = varianceItems?.count || 0;
  const pending = total - counted;
  const progressPercent = total > 0 ? Math.round((counted / total) * 100) : 0;

  return NextResponse.json({
    total,
    counted,
    matched,
    withVariance,
    pending,
    progressPercent,
  });
}
