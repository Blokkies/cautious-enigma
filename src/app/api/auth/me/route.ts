import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stocktakeEvents } from "@/lib/db/schema";
import { getSession, createToken, getTokenCookieOptions, shouldRenewToken } from "@/lib/auth";
import { principalExists } from "@/lib/api-auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // A valid JWT for a deleted account must not keep the session alive.
  if (!(await principalExists(session))) {
    const response = NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    response.cookies.set({ name: "stocktake-token", value: "", maxAge: 0, path: "/" });
    return response;
  }

  const { iat: _iat, exp: _exp, ...user } = session;
  void _iat;
  void _exp;

  // The token's event name/status are a login-time snapshot; report the live
  // values so the UI (e.g. the supervisor read-only banner) stays current.
  if (user.eventId) {
    const [event] = await db
      .select({ name: stocktakeEvents.name, status: stocktakeEvents.status })
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, user.eventId));
    if (event) {
      user.eventName = event.name;
      user.eventStatus = event.status;
    }
  }

  const response = NextResponse.json({ user });

  // Sliding session: once less than half the lifetime remains, re-issue the
  // cookie with a fresh expiry so a team is not logged out mid-count.
  if (shouldRenewToken(session)) {
    response.cookies.set({
      ...getTokenCookieOptions(),
      value: await createToken(user),
    });
  }
  return response;
}
