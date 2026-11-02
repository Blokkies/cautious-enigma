import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyPin, createToken, getTokenCookieOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

// PIN logins: teams live in `teams`; supervisors and auditors share `supervisors`
// and are told apart by `role`. Each account must belong to the chosen event.
const PIN_LOGIN_TYPES = ["team", "supervisor", "auditor"] as const;
type PinLoginType = (typeof PIN_LOGIN_TYPES)[number];

function isPinLoginType(type: unknown): type is PinLoginType {
  return PIN_LOGIN_TYPES.includes(type as PinLoginType);
}

async function findPinAccount(
  type: PinLoginType,
  id: number,
  eventId: number
): Promise<{ id: number; name: string; pinHash: string } | undefined> {
  if (type === "team") {
    const [team] = await db
      .select({ id: teams.id, name: teams.name, pinHash: teams.pinHash })
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.eventId, eventId)));
    return team;
  }
  const [supervisor] = await db
    .select({ id: supervisors.id, name: supervisors.name, pinHash: supervisors.pinHash })
    .from(supervisors)
    .where(and(eq(supervisors.id, id), eq(supervisors.eventId, eventId), eq(supervisors.role, type)));
  return supervisor;
}

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

    if (!isPinLoginType(type)) {
      return NextResponse.json({ error: "Invalid login type" }, { status: 400 });
    }

    const account = await findPinAccount(type, Number(id), event.id);
    if (!account || !(await verifyPin(pin, account.pinHash))) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const user = {
      id: account.id,
      type,
      name: account.name,
      eventId: event.id,
      eventName: event.name,
      eventStatus: event.status,
    };
    const token = await createToken(user);

    const response = NextResponse.json({ success: true, user });
    response.cookies.set({
      ...getTokenCookieOptions(),
      value: token,
    });
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
