import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serial = request.nextUrl.searchParams.get("serial");
  if (!serial) {
    return NextResponse.json({ error: "serial parameter required" }, { status: 400 });
  }

  const [match] = await db
    .select({
      binNumber: items.binNumber,
      itemCode: items.itemCode,
    })
    .from(items)
    .where(
      and(
        eq(items.eventId, user.eventId),
        sql`lower(${items.serialNumber}) = ${serial.toLowerCase()}`
      )
    )
    .limit(1);

  if (match) {
    return NextResponse.json({
      found: true,
      binNumber: match.binNumber,
      itemCode: match.itemCode,
    });
  }

  return NextResponse.json({ found: false });
}
