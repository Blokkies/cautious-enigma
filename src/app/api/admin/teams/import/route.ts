import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPin } from "@/lib/auth";
import { getApiUser } from "@/lib/api-auth";
import { parseTeamExcel } from "@/lib/team-excel";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const eventIdStr = formData.get("eventId") as string | null;

    if (!file || !eventIdStr) {
      return NextResponse.json(
        { error: "file and eventId are required" },
        { status: 400 }
      );
    }

    const eventId = user.type === "admin" ? Number(eventIdStr) : user.eventId;

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 5MB)" },
        { status: 400 }
      );
    }

    // Parse the Excel file
    const buffer = await file.arrayBuffer();
    const { validTeams, errors, totalRows } = parseTeamExcel(buffer);

    if (validTeams.length === 0) {
      return NextResponse.json({
        success: false,
        summary: {
          teamsCreated: 0,
          teamsSkipped: 0,
          totalRows,
          errors: errors.map((e) => `Row ${e.row}: ${e.message}`),
        },
      });
    }

    // Check for name collisions with existing teams in this event
    const existingTeams = await db
      .select({ name: teams.name })
      .from(teams)
      .where(eq(teams.eventId, eventId));

    const existingNames = new Set(existingTeams.map((t) => t.name.toLowerCase()));
    const toCreate = [];
    let skipped = 0;

    for (const team of validTeams) {
      if (existingNames.has(team.name.toLowerCase())) {
        errors.push({ row: 0, message: `Team "${team.name}" already exists in this event (skipped)` });
        skipped++;
      } else {
        toCreate.push(team);
      }
    }

    if (toCreate.length === 0) {
      return NextResponse.json({
        success: false,
        summary: {
          teamsCreated: 0,
          teamsSkipped: skipped,
          totalRows,
          errors: errors.map((e) => e.row ? `Row ${e.row}: ${e.message}` : e.message),
        },
      });
    }

    // Hash all PINs
    const values = await Promise.all(
      toCreate.map(async (team) => ({
        eventId,
        name: team.name,
        members: team.members.length > 0 ? JSON.stringify(team.members) : null,
        pinHash: await hashPin(team.pin),
        pinPlain: team.pin,
      }))
    );

    // Batch insert
    const inserted = await db.insert(teams).values(values).returning({ id: teams.id });

    return NextResponse.json({
      success: true,
      summary: {
        teamsCreated: inserted.length,
        teamsSkipped: skipped,
        totalRows,
        errors: errors.map((e) => e.row ? `Row ${e.row}: ${e.message}` : e.message),
      },
    });
  } catch (error) {
    console.error("Team import error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
