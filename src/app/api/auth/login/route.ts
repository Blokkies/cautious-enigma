import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyPin, createToken, getTokenCookieOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP: 10 attempts per minute
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const { limited, retryAfterMs } = checkRateLimit(`login:${ip}`, 10, 60_000);
    if (limited) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const { type, id, pin, eventId } = await request.json();

    if (!type || !id || !pin) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Resolve the event: use provided eventId, or fall back to finding active event
    let event;
    if (eventId) {
      const [result] = await db
        .select()
        .from(stocktakeEvents)
        .where(eq(stocktakeEvents.id, Number(eventId)));
      event = result;
    } else {
      const [result] = await db
        .select()
        .from(stocktakeEvents)
        .where(eq(stocktakeEvents.status, "active"));
      event = result;
    }

    if (!event) {
      return NextResponse.json(
        { error: "No active stocktake event" },
        { status: 400 }
      );
    }

    if (type === "team") {
      const [team] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.id, Number(id)), eq(teams.eventId, event.id)));

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
        eventId: event.id,
        eventName: event.name,
      });

      const response = NextResponse.json({
        success: true,
        user: { id: team.id, type: "team", name: team.name, eventId: event.id, eventName: event.name },
      });

      response.cookies.set({
        ...getTokenCookieOptions(),
        value: token,
      });

      return response;
    }

    if (type === "supervisor") {
      const [supervisor] = await db
        .select()
        .from(supervisors)
        .where(
          and(
            eq(supervisors.id, Number(id)),
            eq(supervisors.eventId, event.id)
          )
        );

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
        eventId: event.id,
        eventName: event.name,
      });

      const response = NextResponse.json({
        success: true,
        user: {
          id: supervisor.id,
          type: "supervisor",
          name: supervisor.name,
          eventId: event.id,
          eventName: event.name,
        },
      });

      response.cookies.set({
        ...getTokenCookieOptions(),
        value: token,
      });

      return response;
    }

    if (type === "auditor") {
      const [auditor] = await db
        .select()
        .from(supervisors)
        .where(
          and(
            eq(supervisors.id, Number(id)),
            eq(supervisors.eventId, event.id),
            eq(supervisors.role, "auditor")
          )
        );

      if (!auditor) {
        return NextResponse.json(
          { error: "Auditor not found" },
          { status: 401 }
        );
      }

      const valid = await verifyPin(pin, auditor.pinHash);
      if (!valid) {
        return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
      }

      const token = await createToken({
        id: auditor.id,
        type: "auditor",
        name: auditor.name,
        eventId: event.id,
        eventName: event.name,
      });

      const response = NextResponse.json({
        success: true,
        user: {
          id: auditor.id,
          type: "auditor",
          name: auditor.name,
          eventId: event.id,
          eventName: event.name,
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
