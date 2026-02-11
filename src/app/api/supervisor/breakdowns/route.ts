import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { breakdowns, teams, items } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allBreakdowns = db
    .select({
      id: breakdowns.id,
      clientName: breakdowns.clientName,
      quantity: breakdowns.quantity,
      poNumber: breakdowns.poNumber,
      reason: breakdowns.reason,
      approvalStatus: breakdowns.approvalStatus,
      createdAt: breakdowns.createdAt,
      teamName: teams.name,
      itemCode: items.itemCode,
      itemDescription: items.description,
    })
    .from(breakdowns)
    .innerJoin(teams, eq(breakdowns.teamId, teams.id))
    .leftJoin(items, eq(breakdowns.itemId, items.id))
    .where(eq(breakdowns.eventId, user.eventId))
    .orderBy(desc(breakdowns.createdAt))
    .all();

  return NextResponse.json({ breakdowns: allBreakdowns });
}

// Approve/reject breakdown
export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { breakdownId, status } = await request.json();

    if (!breakdownId || !["approved", "rejected"].includes(status)) {
      return NextResponse.json(
        { error: "breakdownId and valid status required" },
        { status: 400 }
      );
    }

    db.update(breakdowns)
      .set({
        approvalStatus: status,
        approvedBy: user.id,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(breakdowns.id, breakdownId))
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Breakdown approval error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
