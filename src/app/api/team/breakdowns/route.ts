import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { breakdowns, items, breakdownMessages, supervisors, auditLog } from "@/lib/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
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
      itemCode: breakdowns.itemCode,
      itemCodeResolved: items.itemCode,
      itemDescription: items.description,
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

  // Fetch messages
  const breakdownIds = teamBreakdowns.map((b) => b.id);
  const messagesMap: Record<number, { senderType: string; senderName: string; message: string; createdAt: string }[]> = {};

  if (breakdownIds.length > 0) {
    const allMsgs = db
      .select({
        breakdownId: breakdownMessages.breakdownId,
        senderType: breakdownMessages.senderType,
        senderId: breakdownMessages.senderId,
        message: breakdownMessages.message,
        createdAt: breakdownMessages.createdAt,
      })
      .from(breakdownMessages)
      .where(inArray(breakdownMessages.breakdownId, breakdownIds))
      .orderBy(asc(breakdownMessages.createdAt))
      .all();

    const supervisorIds = Array.from(new Set(
      allMsgs.filter((m) => m.senderType === "supervisor").map((m) => m.senderId)
    ));
    const supervisorNames: Record<number, string> = {};
    if (supervisorIds.length > 0) {
      const sups = db
        .select({ id: supervisors.id, name: supervisors.name })
        .from(supervisors)
        .where(and(inArray(supervisors.id, supervisorIds), eq(supervisors.eventId, user.eventId)))
        .all();
      for (const s of sups) {
        supervisorNames[s.id] = s.name;
      }
    }

    for (const m of allMsgs) {
      if (!messagesMap[m.breakdownId]) messagesMap[m.breakdownId] = [];
      messagesMap[m.breakdownId].push({
        senderType: m.senderType,
        senderName: m.senderType === "supervisor"
          ? supervisorNames[m.senderId] || "Supervisor"
          : "You",
        message: m.message,
        createdAt: m.createdAt,
      });
    }
  }

  const enriched = teamBreakdowns.map(({ itemCodeResolved, ...b }) => ({
    ...b,
    itemCode: b.itemCode || itemCodeResolved || null,
    messages: messagesMap[b.id] || [],
  }));

  return NextResponse.json({ breakdowns: enriched });
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
        itemCode: itemCode ? String(itemCode) : null,
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

// Team sends a message on a breakdown
export async function PATCH(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { breakdownId, message } = await request.json();

    if (!breakdownId || !message?.trim()) {
      return NextResponse.json(
        { error: "breakdownId and message are required" },
        { status: 400 }
      );
    }

    const breakdown = db
      .select({ id: breakdowns.id, teamId: breakdowns.teamId })
      .from(breakdowns)
      .where(
        and(eq(breakdowns.id, breakdownId), eq(breakdowns.eventId, user.eventId))
      )
      .get();

    if (!breakdown || breakdown.teamId !== user.id) {
      return NextResponse.json({ error: "Breakdown not found" }, { status: 404 });
    }

    db.insert(breakdownMessages)
      .values({
        breakdownId,
        senderType: "team",
        senderId: user.id,
        message: message.trim(),
      })
      .run();

    db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "team",
        action: "breakdown_team_message",
        tableName: "breakdown_messages",
        recordId: breakdownId,
        newValue: JSON.stringify({ message: message.trim() }),
      })
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Team breakdown message error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
