import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["team"], status: 401 });
  if (auth.response) return auth.response;
  const { user } = auth;

  const serial = request.nextUrl.searchParams.get("serial");
  if (!serial) {
    return NextResponse.json({ error: "serial parameter required" }, { status: 400 });
  }

  const warehouses = await getEventWarehouses(user.eventId);

  const [match] = await db
    .select({
      binNumber: items.binNumber,
      itemCode: items.itemCode,
    })
    .from(items)
    .where(
      and(
        eq(items.eventId, user.eventId),
        sql`lower(${items.serialNumber}) = ${serial.toLowerCase()}`,
        warehouseFilter(warehouses),
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
