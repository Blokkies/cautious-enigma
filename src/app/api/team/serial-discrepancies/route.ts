import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serialDiscrepancies } from "@/lib/db/schema";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { itemCode, description, binNumber, unknownSerials } = await request.json();

    if (!itemCode) {
      return NextResponse.json(
        { error: "itemCode is required" },
        { status: 400 }
      );
    }

    if (!unknownSerials || !Array.isArray(unknownSerials) || unknownSerials.length === 0) {
      return NextResponse.json(
        { error: "unknownSerials must be a non-empty array" },
        { status: 400 }
      );
    }

    const [{ id }] = await db
      .insert(serialDiscrepancies)
      .values({
        eventId: user.eventId,
        teamId: user.id,
        itemCode,
        description: description || null,
        binNumber: binNumber || null,
        unknownSerials: JSON.stringify(unknownSerials),
        status: "open",
      })
      .returning({ id: serialDiscrepancies.id });

    return NextResponse.json({
      success: true,
      id,
    });
  } catch (error) {
    console.error("Serial discrepancy creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
