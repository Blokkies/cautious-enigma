import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, verificationAssignments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all items assigned to this team with their count status
  const teamItems = await db
    .select({
      id: items.id,
      itemCode: items.itemCode,
      description: items.description,
      brand: items.brand,
      category: items.category,
      binNumber: items.binNumber,
      binInternalId: items.binInternalId,
      warehouse: items.warehouse,
      onHand: items.onHand,
      avgCost: items.avgCost,
      totalValue: items.totalValue,
      stockStatus: items.stockStatus,
      serialNumber: items.serialNumber,
      isSerialized: items.isSerialized,
      countId: counts.id,
      countedQty: counts.countedQty,
      variance: counts.variance,
      isMatch: counts.isMatch,
      comment: counts.comment,
      checkStatus: counts.checkStatus,
      countedAt: counts.countedAt,
    })
    .from(items)
    .leftJoin(
      counts,
      and(eq(counts.itemId, items.id), eq(counts.teamId, user.id))
    )
    .where(
      and(eq(items.eventId, user.eventId), eq(items.teamId, user.id))
    )
    .orderBy(items.binNumber, items.itemCode);

  // Group by bin number
  const groupedByBin: Record<
    string,
    typeof teamItems
  > = {};

  for (const item of teamItems) {
    const bin = item.binNumber || "No Bin";
    if (!groupedByBin[bin]) {
      groupedByBin[bin] = [];
    }
    groupedByBin[bin].push(item);
  }

  // Calculate stats
  const total = teamItems.length;
  const counted = teamItems.filter((i) => i.countId !== null).length;
  const progressPercent = total > 0 ? Math.round((counted / total) * 100) : 0;

  // Fetch verification assignments for this team
  const verificationItems = await db
    .select({
      verificationId: verificationAssignments.id,
      countId: verificationAssignments.countId,
      itemId: items.id,
      itemCode: items.itemCode,
      description: items.description,
      brand: items.brand,
      category: items.category,
      binNumber: items.binNumber,
      binInternalId: items.binInternalId,
      warehouse: items.warehouse,
      onHand: items.onHand,
      avgCost: items.avgCost,
      totalValue: items.totalValue,
      stockStatus: items.stockStatus,
      serialNumber: items.serialNumber,
      isSerialized: items.isSerialized,
      assignedAt: verificationAssignments.assignedAt,
    })
    .from(verificationAssignments)
    .innerJoin(items, eq(verificationAssignments.itemId, items.id))
    .where(
      and(
        eq(verificationAssignments.assignedTeamId, user.id),
        eq(verificationAssignments.eventId, user.eventId),
        eq(verificationAssignments.status, "pending")
      )
    )
    .orderBy(items.binNumber, items.itemCode);

  return NextResponse.json({
    items: teamItems,
    groupedByBin,
    stats: { total, counted, progressPercent },
    verificationItems,
  });
}
