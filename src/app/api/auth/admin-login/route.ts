import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { admins } from "@/lib/db/schema";
import { createToken, getTokenCookieOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin2026";
if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV === "production") {
  throw new Error("ADMIN_PASSWORD must be set in production. Set ADMIN_PASSWORD in .env.local.");
} else if (!process.env.ADMIN_PASSWORD) {
  console.warn("[SECURITY] ADMIN_PASSWORD not set — using default. Set ADMIN_PASSWORD in .env.local for production.");
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP: 5 attempts per minute for admin login
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const { limited, retryAfterMs } = checkRateLimit(`admin-login:${ip}`, 5, 60_000);
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

    // Try to match against admins in the database
    const allAdmins = await db.select().from(admins);

    // If no admins exist, accept env var password and auto-create admin row
    if (allAdmins.length === 0) {
      if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
      const hash = await bcrypt.hash(password, 10);
      const [{ id }] = await db
        .insert(admins)
        .values({ name: "Admin", passwordHash: hash })
        .returning({ id: admins.id });

      const token = await createToken({
        id,
        type: "admin",
        name: "Admin",
        eventId: 0,
        eventName: "",
      });

      const response = NextResponse.json({
        success: true,
        user: { id, type: "admin", name: "Admin" },
      });
      response.cookies.set({ ...getTokenCookieOptions(), value: token });
      return response;
    }

    // Check password against each admin
    for (const admin of allAdmins) {
      if (await bcrypt.compare(password, admin.passwordHash)) {
        const token = await createToken({
          id: admin.id,
          type: "admin",
          name: admin.name,
          eventId: 0,
          eventName: "",
        });

        const response = NextResponse.json({
          success: true,
          user: { id: admin.id, type: "admin", name: admin.name },
        });
        response.cookies.set({ ...getTokenCookieOptions(), value: token });
        return response;
      }
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    console.error("Admin login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
