import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { admins } from "@/lib/db/schema";
import { createToken, getTokenCookieOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

// Development-only bootstrap password, used when ADMIN_PASSWORD is unset and
// NODE_ENV is not "production". Production never falls back to it.
const DEV_BOOTSTRAP_PASSWORD = "admin2026";

/**
 * Password that may create the first admin while the admins table is empty.
 * Read per request (not at module load) so a missing env var neither crashes
 * the build nor locks out admins that already exist in the database.
 * Returns null in production when ADMIN_PASSWORD is not set.
 */
function getBootstrapPassword(): string | null {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production") return null;
  console.warn("[SECURITY] ADMIN_PASSWORD not set — using the development default. Set ADMIN_PASSWORD for production.");
  return DEV_BOOTSTRAP_PASSWORD;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP: 5 attempts per minute for admin login
    const ip = getClientIp(request);
    const { limited, retryAfterMs } = checkRateLimit(`admin-login:${ip}`, 5, 60_000);
    if (limited) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const { password } = await request.json();

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    // Try to match against admins in the database
    const allAdmins = await db.select().from(admins);

    // If no admins exist, accept env var password and auto-create admin row
    if (allAdmins.length === 0) {
      const bootstrapPassword = getBootstrapPassword();
      if (bootstrapPassword === null) {
        console.error("[SECURITY] No admin accounts exist and ADMIN_PASSWORD is not set; admin bootstrap is disabled.");
        return NextResponse.json(
          { error: "No admin accounts are configured. Set ADMIN_PASSWORD on the server." },
          { status: 503 }
        );
      }
      if (password !== bootstrapPassword) {
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
