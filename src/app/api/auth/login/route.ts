import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyPin, createToken, getTokenCookieOptions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { type, id, pin } = await request.json();

    if (!type || !id || !pin) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Find active event
    const activeEvent = db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.status, "active"))
      .get();

    if (!activeEvent) {
      return NextResponse.json(
        { error: "No active stocktake event" },
        { status: 400 }
      );
    }

    if (type === "team") {
      const team = db
        .select()
        .from(teams)
        .where(and(eq(teams.id, Number(id)), eq(teams.eventId, activeEvent.id)))
        .get();

      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 401 });
      }

      const valid = await verifyPin(pin, team.pinHash);
      if (!valid) {
        return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
      }

      const token = await createToken({
        id: team.id,
        type: "team",
        name: team.name,
        eventId: activeEvent.id,
      });

      const response = NextResponse.json({
        success: true,
        user: { id: team.id, type: "team", name: team.name },
      });

      response.cookies.set({
        ...getTokenCookieOptions(),
        value: token,
      });

      return response;
    }

    if (type === "supervisor") {
      const supervisor = db
        .select()
        .from(supervisors)
        .where(
          and(
            eq(supervisors.id, Number(id)),
            eq(supervisors.eventId, activeEvent.id)
          )
        )
        .get();

      if (!supervisor) {
        return NextResponse.json(
          { error: "Supervisor not found" },
          { status: 401 }
        );
      }

      const valid = await verifyPin(pin, supervisor.pinHash);
      if (!valid) {
        return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
      }

      const token = await createToken({
        id: supervisor.id,
        type: "supervisor",
        name: supervisor.name,
        eventId: activeEvent.id,
      });

      const response = NextResponse.json({
        success: true,
        user: {
          id: supervisor.id,
          type: "supervisor",
          name: supervisor.name,
        },
      });

      response.cookies.set({
        ...getTokenCookieOptions(),
        value: token,
      });

      return response;
    }

    return NextResponse.json({ error: "Invalid login type" }, { status: 400 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
