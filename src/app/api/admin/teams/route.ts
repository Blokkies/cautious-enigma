import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, items } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashPin } from "@/lib/auth";
import { getApiUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";

function getAuthorizedEventId(request: NextRequest, clientEventId?: number | string | null): number | null {
  const user = getApiUser(request);
  if (!user) return null;
  if (user.type === "admin") return clientEventId ? Number(clientEventId) : null;
  if (user.type === "supervisor" || user.type === "auditor") return user.eventId;
  return null;
}

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor" && user.type !== "auditor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const eid = getAuthorizedEventId(request, request.nextUrl.searchParams.get("eventId"));
  if (!eid) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const warehouses = await getEventWarehouses(eid);

  const teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.eventId, eid));

  // Count assigned items per team (filtered by event's selected warehouses)
  const enriched = await Promise.all(teamList.map(async (team) => {
    const assignedCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(
        and(eq(items.eventId, eid), eq(items.teamId, team.id), warehouseFilter(warehouses))
      );

    const [assignedCount] = assignedCountResult;

    return {
      ...team,
      pinHash: undefined, // Don't send hash to client
      pinPlain: (user.type === "supervisor" || user.type === "admin") ? team.pinPlain : undefined,
      assignedItems: assignedCount?.count || 0,
    };
  }));

  const supervisorList = await db
    .select({
      id: supervisors.id,
      name: supervisors.name,
      role: supervisors.role,
      pinPlain: supervisors.pinPlain,
    })
    .from(supervisors)
    .where(eq(supervisors.eventId, eid));

  const supervisorListSafe = supervisorList.map((s) => ({
    ...s,
    pinPlain: (user.type === "supervisor" || user.type === "admin") ? s.pinPlain : undefined,
  }));

  return NextResponse.json({ teams: enriched, supervisors: supervisorListSafe });
}

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { type, name, members, pin, role } = body;
    const eid = getAuthorizedEventId(request, body.eventId);

    if (!eid || !name || !pin) {
      return NextResponse.json(
        { error: "eventId, name, and pin are required" },
        { status: 400 }
      );
    }

    const pinHashed = await hashPin(pin);

    if (type === "supervisor" || type === "auditor") {
      const [result] = await db
        .insert(supervisors)
        .values({
          eventId: eid,
          name,
          pinHash: pinHashed,
          pinPlain: pin,
          role: type === "auditor" ? "auditor" : (role || "supervisor"),
        })
        .returning({ id: supervisors.id });

      return NextResponse.json({
        success: true,
        id: result.id,
        type,
      });
    }

    // Default: create team
    const [result] = await db
      .insert(teams)
      .values({
        eventId: eid,
        name,
        members: members ? JSON.stringify(members) : null,
        pinHash: pinHashed,
        pinPlain: pin,
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
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id, name, members, pin } = await request.json();

    if (!id || !name) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 }
      );
    }

    // Supervisor: verify team belongs to their event
    if (user.type === "supervisor") {
      const [team] = await db.select({ eventId: teams.eventId }).from(teams).where(eq(teams.id, Number(id)));
      if (!team || team.eventId !== user.eventId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const updateData: { name: string; members: string | null; pinHash?: string; pinPlain?: string } = {
      name,
      members: members ? JSON.stringify(members) : null,
    };

    if (pin && pin.length >= 4) {
      updateData.pinHash = await hashPin(pin);
      updateData.pinPlain = pin;
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
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id, type } = await request.json();

    if (type === "supervisor") {
      // Supervisors cannot delete other supervisors
      if (user.type === "supervisor") {
        return NextResponse.json({ error: "Supervisors cannot delete other supervisors" }, { status: 403 });
      }
      await db.delete(supervisors).where(eq(supervisors.id, id));
    } else {
      // Supervisor: verify team belongs to their event
      if (user.type === "supervisor") {
        const [team] = await db.select({ eventId: teams.eventId }).from(teams).where(eq(teams.id, Number(id)));
        if (!team || team.eventId !== user.eventId) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
      }
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
