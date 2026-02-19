import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { executives } from "@/lib/db/schema";
import { createToken, getTokenCookieOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const { limited, retryAfterMs } = checkRateLimit(`exec-login:${ip}`, 5, 60_000);
    if (limited) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    const allExecs = await db.select().from(executives);

    if (allExecs.length === 0) {
      return NextResponse.json({ error: "No executive accounts configured" }, { status: 401 });
    }

    for (const exec of allExecs) {
      if (await bcrypt.compare(password, exec.passwordHash)) {
        const token = await createToken({
          id: exec.id,
          type: "executive",
          name: exec.name,
          eventId: 0,
          eventName: "",
        });

        const response = NextResponse.json({
          success: true,
          user: { id: exec.id, type: "executive", name: exec.name },
        });
        response.cookies.set({ ...getTokenCookieOptions(), value: token });
        return response;
      }
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    console.error("Executive login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
