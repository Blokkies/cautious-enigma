import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, items } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashPin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");

  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.eventId, Number(eventId)));

  // Count assigned items per team
  const enriched = await Promise.all(teamList.map(async (team) => {
    const assignedCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(
        and(eq(items.eventId, Number(eventId)), eq(items.teamId, team.id))
      );

    const [assignedCount] = assignedCountResult;

    return {
      ...team,
      pinHash: undefined, // Don't send hash to client
      assignedItems: assignedCount?.count || 0,
    };
  }));

  const supervisorList = await db
    .select({
      id: supervisors.id,
      name: supervisors.name,
      role: supervisors.role,
    })
    .from(supervisors)
    .where(eq(supervisors.eventId, Number(eventId)));

  return NextResponse.json({ teams: enriched, supervisors: supervisorList });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, type, name, member1, member2, pin, role } = body;

    if (!eventId || !name || !pin) {
      return NextResponse.json(
        { error: "eventId, name, and pin are required" },
        { status: 400 }
      );
    }

    const pinHashed = await hashPin(pin);

    if (type === "supervisor") {
      const [result] = await db
        .insert(supervisors)
        .values({
          eventId: Number(eventId),
          name,
          pinHash: pinHashed,
          role: role || "supervisor",
        })
        .returning({ id: supervisors.id });

      return NextResponse.json({
        success: true,
        id: result.id,
        type: "supervisor",
      });
    }

    // Default: create team
    const [result] = await db
      .insert(teams)
      .values({
        eventId: Number(eventId),
        name,
        member1: member1 || null,
        member2: member2 || null,
        pinHash: pinHashed,
      })
      .returning({ id: teams.id });

    return NextResponse.json({
      success: true,
      id: result.id,
      type: "team",
    });
  } catch (error) {
    console.error("Create team/supervisor error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, name, member1, member2, pin } = await request.json();

    if (!id || !name) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 }
      );
    }

    const updateData: { name: string; member1: string | null; member2: string | null; pinHash?: string } = {
      name,
      member1: member1 || null,
      member2: member2 || null,
    };

    if (pin && pin.length >= 4) {
      updateData.pinHash = await hashPin(pin);
    }

    await db.update(teams)
      .set(updateData)
      .where(eq(teams.id, Number(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update team error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id, type } = await request.json();

    if (type === "supervisor") {
      await db.delete(supervisors).where(eq(supervisors.id, id));
    } else {
      // Unassign items first
      await db.update(items).set({ teamId: null }).where(eq(items.teamId, id));
      await db.delete(teams).where(eq(teams.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
