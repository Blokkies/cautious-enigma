import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { breakdowns, teams, items, breakdownMessages, supervisors, auditLog } from "@/lib/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "auditor" && user.type !== "executive")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allBreakdowns = await db
    .select({
      id: breakdowns.id,
      clientName: breakdowns.clientName,
      quantity: breakdowns.quantity,
      poNumber: breakdowns.poNumber,
      reason: breakdowns.reason,
      approvalStatus: breakdowns.approvalStatus,
      createdAt: breakdowns.createdAt,
      teamName: teams.name,
      teamMembers: teams.members,
      itemCode: breakdowns.itemCode,
      itemCodeResolved: items.itemCode,
      itemDescription: items.description,
    })
    .from(breakdowns)
    .innerJoin(teams, eq(breakdowns.teamId, teams.id))
    .leftJoin(items, eq(breakdowns.itemId, items.id))
    .where(eq(breakdowns.eventId, user.eventId))
    .orderBy(desc(breakdowns.createdAt));

  // Fetch messages for all breakdowns
  const breakdownIds = allBreakdowns.map((b) => b.id);
  const teamNameById: Record<number, string> = {};
  for (const b of allBreakdowns) {
    teamNameById[b.id] = b.teamName;
  }

  const messagesMap: Record<number, { senderType: string; senderName: string; message: string; createdAt: string }[]> = {};

  if (breakdownIds.length > 0) {
    const allMsgs = await db
      .select({
        breakdownId: breakdownMessages.breakdownId,
        senderType: breakdownMessages.senderType,
        senderId: breakdownMessages.senderId,
        message: breakdownMessages.message,
        createdAt: breakdownMessages.createdAt,
      })
      .from(breakdownMessages)
      .where(inArray(breakdownMessages.breakdownId, breakdownIds))
      .orderBy(asc(breakdownMessages.createdAt));

    // Look up supervisor names
    const supervisorIds = Array.from(new Set(
      allMsgs.filter((m) => m.senderType === "supervisor").map((m) => m.senderId)
    ));
    const supervisorNames: Record<number, string> = {};
    if (supervisorIds.length > 0) {
      const sups = await db
        .select({ id: supervisors.id, name: supervisors.name })
        .from(supervisors)
        .where(and(inArray(supervisors.id, supervisorIds), eq(supervisors.eventId, user.eventId)));
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
          : teamNameById[m.breakdownId] || "Team",
        message: m.message,
        createdAt: m.createdAt,
      });
    }
  }

  const enriched = allBreakdowns.map(({ itemCodeResolved, ...b }) => ({
    ...b,
    itemCode: b.itemCode || itemCodeResolved || null,
    messages: messagesMap[b.id] || [],
  }));

  return NextResponse.json({ breakdowns: enriched });
}

// Approve/reject breakdown or send a message
export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { breakdownId, status, message } = await request.json();

    if (!breakdownId) {
      return NextResponse.json(
        { error: "breakdownId is required" },
        { status: 400 }
      );
    }

    // If a message was provided, add it
    if (message) {
      await db.insert(breakdownMessages)
        .values({
          breakdownId,
          senderType: "supervisor",
          senderId: user.id,
          message,
        });
    }

    // If status change requested
    if (status && ["approved", "rejected", "pending"].includes(status)) {
      await db.update(breakdowns)
        .set({
          approvalStatus: status,
          approvedBy: user.id,
          resolvedAt: status === "pending" ? null : new Date().toISOString(),
        })
        .where(and(eq(breakdowns.id, breakdownId), eq(breakdowns.eventId, user.eventId)));

      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: `breakdown_${status}`,
          tableName: "breakdowns",
          recordId: breakdownId,
          newValue: JSON.stringify({ status, ...(message ? { message } : {}) }),
        });
    } else if (message) {
      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: "breakdown_message",
          tableName: "breakdown_messages",
          recordId: breakdownId,
          newValue: JSON.stringify({ message }),
        });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Breakdown action error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Delete a breakdown
export async function DELETE(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { breakdownId } = await request.json();

    if (!breakdownId) {
      return NextResponse.json(
        { error: "breakdownId is required" },
        { status: 400 }
      );
    }

    const [breakdown] = await db
      .select({ id: breakdowns.id })
      .from(breakdowns)
      .where(and(eq(breakdowns.id, breakdownId), eq(breakdowns.eventId, user.eventId)));

    if (!breakdown) {
      return NextResponse.json({ error: "Breakdown not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx.delete(breakdownMessages).where(eq(breakdownMessages.breakdownId, breakdownId));
      await tx.delete(breakdowns).where(eq(breakdowns.id, breakdownId));
      await tx.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: "breakdown_deleted",
          tableName: "breakdowns",
          recordId: breakdownId,
        });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Breakdown delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
