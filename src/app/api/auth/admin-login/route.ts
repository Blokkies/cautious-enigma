import { NextRequest, NextResponse } from "next/server";
import { createToken, getTokenCookieOptions } from "@/lib/auth";

// Simple admin password for setup phase - not a team/supervisor PIN
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin2026";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = await createToken({
      id: 0,
      type: "admin",
      name: "Admin",
      eventId: 0,
      eventName: "",
    });

    const response = NextResponse.json({
      success: true,
      user: { id: 0, type: "admin", name: "Admin" },
    });

    response.cookies.set({
      ...getTokenCookieOptions(),
      value: token,
    });

    return response;
  } catch (error) {
    console.error("Admin login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
