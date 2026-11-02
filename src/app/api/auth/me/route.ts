import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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
  return NextResponse.json({ user: session });
}
