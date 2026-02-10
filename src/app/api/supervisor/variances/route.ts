import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const variances = db
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
      teamName: teams.name,
      comment: counts.comment,
      checkStatus: counts.checkStatus,
      countedAt: counts.countedAt,
    })
    .from(counts)
    .innerJoin(items, eq(counts.itemId, items.id))
    .innerJoin(teams, eq(counts.teamId, teams.id))
    .where(
      and(eq(counts.eventId, user.eventId), eq(counts.isMatch, false))
    )
    .orderBy(sql`abs(variance_value) DESC`)
    .all();

  const totalVarianceValue = variances.reduce(
    (sum, v) => sum + Math.abs(v.varianceValue || 0),
    0
  );

  return NextResponse.json({ variances, totalVarianceValue });
}
