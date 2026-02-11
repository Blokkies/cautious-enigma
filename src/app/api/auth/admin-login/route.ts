import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { admins } from "@/lib/db/schema";
import { createToken, getTokenCookieOptions } from "@/lib/auth";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin2026";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    // Try to match against admins in the database
    const allAdmins = db.select().from(admins).all();

    // If no admins exist, accept env var password and auto-create admin row
    if (allAdmins.length === 0) {
      if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
      const hash = bcrypt.hashSync(password, 10);
      const result = db.insert(admins).values({ name: "Admin", passwordHash: hash }).run();

      const token = await createToken({
        id: Number(result.lastInsertRowid),
        type: "admin",
        name: "Admin",
        eventId: 0,
        eventName: "",
      });

      const response = NextResponse.json({
        success: true,
        user: { id: Number(result.lastInsertRowid), type: "admin", name: "Admin" },
      });
      response.cookies.set({ ...getTokenCookieOptions(), value: token });
      return response;
    }

    // Check password against each admin
    for (const admin of allAdmins) {
      if (bcrypt.compareSync(password, admin.passwordHash)) {
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
