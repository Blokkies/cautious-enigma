import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

// Public liveness/readiness probe for Coolify / Docker HEALTHCHECK.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", version: APP_VERSION });
  } catch {
    return NextResponse.json({ status: "db_unavailable", version: APP_VERSION }, { status: 503 });
  }
}
