import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { breakdowns, items } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamBreakdowns = db
    .select({
      id: breakdowns.id,
      clientName: breakdowns.clientName,
      quantity: breakdowns.quantity,
      poNumber: breakdowns.poNumber,
      reason: breakdowns.reason,
      approvalStatus: breakdowns.approvalStatus,
      createdAt: breakdowns.createdAt,
      itemCode: items.itemCode,
    })
    .from(breakdowns)
    .leftJoin(items, eq(breakdowns.itemId, items.id))
    .where(
      and(
        eq(breakdowns.teamId, user.id),
        eq(breakdowns.eventId, user.eventId)
      )
    )
    .orderBy(desc(breakdowns.createdAt))
    .all();

  return NextResponse.json({ breakdowns: teamBreakdowns });
}

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { clientName, itemCode, quantity, poNumber, reason } =
      await request.json();

    if (!clientName || quantity === undefined) {
      return NextResponse.json(
        { error: "clientName and quantity are required" },
        { status: 400 }
      );
    }

    let resolvedItemId: number | null = null;
    if (itemCode) {
      const item = db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.itemCode, String(itemCode)),
            eq(items.eventId, user.eventId)
          )
        )
        .get();
      resolvedItemId = item?.id || null;
    }

    const result = db
      .insert(breakdowns)
      .values({
        eventId: user.eventId,
        teamId: user.id,
        itemId: resolvedItemId,
        clientName,
        quantity,
        poNumber: poNumber || null,
        reason: reason || null,
      })
      .run();

    return NextResponse.json({
      success: true,
      id: Number(result.lastInsertRowid),
    });
  } catch (error) {
    console.error("Breakdown creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
