import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, verificationAssignments, serialDiscrepancies, teams } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const warehouses = await getEventWarehouses(user.eventId);

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
      and(eq(items.eventId, user.eventId), eq(items.teamId, user.id), warehouseFilter(warehouses))
    )
    .orderBy(items.binNumber, items.itemCode);

  // Find items with pending verification assignments (locked for original team)
  const pendingVerificationItemIds = await db
    .select({ itemId: verificationAssignments.itemId })
    .from(verificationAssignments)
    .where(and(
      eq(verificationAssignments.eventId, user.eventId),
      eq(verificationAssignments.status, "pending")
    ));
  const pendingVerificationSet = new Set(pendingVerificationItemIds.map((r) => r.itemId));

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
        eq(verificationAssignments.status, "pending"),
        warehouseFilter(warehouses)
      )
    )
    .orderBy(items.binNumber, items.itemCode);

  // Fetch serial verification tasks assigned to this team
  const serialVerificationTasks = await db
    .select({
      id: serialDiscrepancies.id,
      itemCode: serialDiscrepancies.itemCode,
      description: serialDiscrepancies.description,
      binNumber: serialDiscrepancies.binNumber,
      unknownSerials: serialDiscrepancies.unknownSerials,
      verificationAssignedAt: serialDiscrepancies.verificationAssignedAt,
    })
    .from(serialDiscrepancies)
    .where(
      and(
        eq(serialDiscrepancies.verificationTeamId, user.id),
        eq(serialDiscrepancies.verificationStatus, "pending"),
        eq(serialDiscrepancies.eventId, user.eventId),
        eq(serialDiscrepancies.status, "open")
      )
    )
    .orderBy(serialDiscrepancies.createdAt);

  // Parse unknownSerials JSON for each task (with safe fallback)
  const parsedSerialTasks = serialVerificationTasks.map((task) => {
    let unknowns: string[] = [];
    try { unknowns = JSON.parse(task.unknownSerials) as string[]; } catch { /* malformed JSON, default to empty */ }
    return { ...task, unknownSerials: unknowns };
  });

  // Fetch team members
  const [team] = await db
    .select({ members: teams.members })
    .from(teams)
    .where(and(eq(teams.id, user.id), eq(teams.eventId, user.eventId)));

  let memberNames: string[] = [];
  if (team?.members) {
    try { memberNames = JSON.parse(team.members); } catch { /* ignore */ }
  }

  return NextResponse.json({
    items: teamItems.map((item) => ({
      ...item,
      hasPendingVerification: pendingVerificationSet.has(item.id),
    })),
    groupedByBin,
    stats: { total, counted, progressPercent },
    verificationItems,
    serialVerificationTasks: parsedSerialTasks,
    members: memberNames,
  });
}
