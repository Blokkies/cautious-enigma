import { normalizeMembers } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, items, counts, queries, queryMessages, breakdowns, breakdownMessages, teamAssignments, verificationAssignments, serialDiscrepancies, execMessages } from "@/lib/db/schema";
import { eq, and, ne, sql, isNotNull } from "drizzle-orm";
import { hashPin } from "@/lib/auth";
import { requireUser, resolveEventId, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";
import { checkEventWritable } from "../event-guard";
import { countInt } from "@/lib/db/aggregates";
import { parseId } from "@/lib/ids";
import { normalizePin, PIN_RULE_MESSAGE } from "@/lib/pin";

// Account kinds this route manages. Teams live in `teams`; supervisors and
// auditors share `supervisors`, told apart by `role`.
const ACCOUNT_TYPES = ["team", "supervisor", "auditor"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];
const SUPERVISOR_ROLES = ["supervisor", "auditor"] as const;

/** Missing type means "team" (the historical default); unknown strings are rejected. */
function parseAccountType(value: unknown): AccountType | null {
  if (value === undefined || value === null || value === "") return "team";
  return ACCOUNT_TYPES.includes(value as AccountType) ? (value as AccountType) : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor", "auditor"] });
  if (auth.response) return auth.response;
  const { user } = auth;

  const eid = resolveEventId(user, request.nextUrl.searchParams.get("eventId"));
  if (!eid) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const warehouses = await getEventWarehouses(eid);

  const teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.eventId, eid));

  // Count assigned items per team in a single GROUP BY query
  const teamItemCounts = await db
    .select({ teamId: items.teamId, count: countInt() })
    .from(items)
    .where(and(eq(items.eventId, eid), isNotNull(items.teamId), warehouseFilter(warehouses)))
    .groupBy(items.teamId);
  const teamItemMap = new Map(teamItemCounts.map((r) => [r.teamId, r.count]));

  const enriched = teamList.map((team) => ({
    ...team,
    pinHash: undefined, // Don't send hash to client
    pinPlain: (user.type === "supervisor" || user.type === "admin") ? team.pinPlain : undefined,
    assignedItems: teamItemMap.get(team.id) || 0,
  }));

  const supervisorList = await db
    .select({
      id: supervisors.id,
      name: supervisors.name,
      role: supervisors.role,
      pinPlain: supervisors.pinPlain,
    })
    .from(supervisors)
    .where(eq(supervisors.eventId, eid));

  // Supervisor/auditor PINs are their login credentials: only admins see them.
  const supervisorListSafe = supervisorList.map((s) => ({
    ...s,
    pinPlain: user.type === "admin" ? s.pinPlain : undefined,
  }));

  return NextResponse.json({ teams: enriched, supervisors: supervisorListSafe });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const { name, members, role } = body;
    const eid = resolveEventId(user, body.eventId);

    if (!eid || !isNonEmptyString(name) || body.pin === undefined || body.pin === null || body.pin === "") {
      return NextResponse.json(
        { error: "eventId, name, and pin are required" },
        { status: 400 }
      );
    }

    const type = parseAccountType(body.type);
    if (!type) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (role !== undefined && role !== null && !SUPERVISOR_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    // Supervisors manage the teams of their own event only (resolveEventId pins
    // them to their token's event); creating supervisors/auditors is admin-only.
    if (user.type !== "admin" && type !== "team") {
      return NextResponse.json({ error: "Only admins can create supervisors and auditors" }, { status: 403 });
    }

    const pin = normalizePin(body.pin);
    if (!pin) {
      return NextResponse.json({ error: PIN_RULE_MESSAGE }, { status: 400 });
    }

    const guard = await checkEventWritable(eid, user.type);
    if (guard) return NextResponse.json({ error: guard }, { status: 403 });

    const pinHashed = await hashPin(pin);

    if (type === "supervisor" || type === "auditor") {
      const [result] = await db
        .insert(supervisors)
        .values({
          eventId: eid,
          name,
          pinHash: pinHashed,
          pinPlain: pin,
          role: type === "auditor" ? "auditor" : (role || "supervisor"),
        })
        .returning({ id: supervisors.id });

      return NextResponse.json({
        success: true,
        id: result.id,
        type,
      });
    }

    // Default: create team
    const [result] = await db
      .insert(teams)
      .values({
        eventId: eid,
        name,
        members: normalizeMembers(members).length ? JSON.stringify(normalizeMembers(members)) : null,
        pinHash: pinHashed,
        pinPlain: pin,
      })
      .returning({ id: teams.id });

    return NextResponse.json({
      success: true,
      id: result.id,
      type: "team",
    });
  } catch (error) {
    console.error("Create team/supervisor error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const { id: rawId, name, members, pin: rawPin } = await request.json();

    if (!rawId || !isNonEmptyString(name)) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 }
      );
    }
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    // PIN is optional on edit (keep the current one); if given it must be valid.
    const hasPin = rawPin !== undefined && rawPin !== null && rawPin !== "";
    const pin = hasPin ? normalizePin(rawPin) : null;
    if (hasPin && !pin) {
      return NextResponse.json({ error: PIN_RULE_MESSAGE }, { status: 400 });
    }

    const [team] = await db.select({ eventId: teams.eventId }).from(teams).where(eq(teams.id, id));
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    // Supervisor: verify team belongs to their event
    if (user.type === "supervisor" && team.eventId !== user.eventId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const guard = await checkEventWritable(team.eventId, user.type);
    if (guard) return NextResponse.json({ error: guard }, { status: 403 });

    const updateData: { name: string; members: string | null; pinHash?: string; pinPlain?: string } = {
      name,
      members: normalizeMembers(members).length ? JSON.stringify(normalizeMembers(members)) : null,
    };

    if (pin) {
      updateData.pinHash = await hashPin(pin);
      updateData.pinPlain = pin;
    }

    await db.update(teams)
      .set(updateData)
      .where(eq(teams.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update team error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const type = parseAccountType(body.type);
    if (!type) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    const id = parseId(body.id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    if (type === "supervisor" || type === "auditor") {
      // Supervisors cannot delete supervisors or auditors
      if (user.type !== "admin") {
        return NextResponse.json({ error: "Supervisors cannot delete other supervisors" }, { status: 403 });
      }
      const supId = id;
      const [sup] = await db.select({ eventId: supervisors.eventId }).from(supervisors).where(eq(supervisors.id, supId));
      if (!sup) {
        return NextResponse.json({ error: "Supervisor not found" }, { status: 404 });
      }
      // Never on a completed/locked stocktake: the supervisor's actions are part of its record
      const guard = await checkEventWritable(sup.eventId, user.type, true);
      if (guard) return NextResponse.json({ error: guard }, { status: 403 });

      // verification_assignments.assigned_by is NOT NULL, so finished verifications can't be
      // detached from the supervisor who ordered them. Keep that history: refuse the delete.
      const [history] = await db
        .select({ count: countInt() })
        .from(verificationAssignments)
        .where(and(eq(verificationAssignments.assignedBy, supId), ne(verificationAssignments.status, "pending")));
      const historyCount = history?.count || 0;
      if (historyCount > 0) {
        return NextResponse.json(
          {
            error: `This supervisor ordered ${historyCount} verification${historyCount === 1 ? "" : "s"} that ${historyCount === 1 ? "has" : "have"} already been completed. Deleting them would erase that verification history.`,
            verificationHistoryCount: historyCount,
          },
          { status: 409 }
        );
      }

      await db.transaction(async (tx) => {
        // Clear FK references before deleting supervisor
        await tx.delete(execMessages).where(eq(execMessages.supervisorId, supId));
        // Only still-pending verifications they ordered (completed ones were refused above;
        // the status condition also keeps any that completed in the meantime, making the
        // supervisor delete fail on the FK rather than erase them)
        await tx.delete(verificationAssignments).where(
          and(eq(verificationAssignments.assignedBy, supId), eq(verificationAssignments.status, "pending"))
        );
        await tx.update(queries).set({ respondedBy: null }).where(eq(queries.respondedBy, supId));
        await tx.update(breakdowns).set({ approvedBy: null }).where(eq(breakdowns.approvedBy, supId));
        await tx.update(serialDiscrepancies).set({ resolvedBy: null }).where(eq(serialDiscrepancies.resolvedBy, supId));
        await tx.update(serialDiscrepancies).set({ verificationAssignedBy: null }).where(eq(serialDiscrepancies.verificationAssignedBy, supId));
        await tx.delete(supervisors).where(eq(supervisors.id, supId));
      });
    } else {
      const [team] = await db.select({ eventId: teams.eventId }).from(teams).where(eq(teams.id, id));
      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }
      // Supervisor: verify team belongs to their event
      if (user.type === "supervisor" && team.eventId !== user.eventId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      // Deleting a team deletes its counts
      const guard = await checkEventWritable(team.eventId, user.type, true);
      if (guard) return NextResponse.json({ error: guard }, { status: 403 });
      // Cascade delete team's dependent data in a transaction
      await db.transaction(async (tx) => {
        // Messages on queries/breakdowns for this team
        await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE team_id = ${id})`);
        await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE team_id = ${id})`);
        // Verification assignments (assigned to this team, or pointing at this team's counts)
        await tx.delete(verificationAssignments).where(eq(verificationAssignments.assignedTeamId, id));
        await tx.delete(verificationAssignments).where(sql`count_id IN (SELECT id FROM counts WHERE team_id = ${id})`);
        // Serial discrepancies owned by this team; clear verification refs from other teams' discrepancies
        await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.teamId, id));
        await tx.update(serialDiscrepancies).set({ verificationTeamId: null }).where(eq(serialDiscrepancies.verificationTeamId, id));
        // Counts, queries, breakdowns
        await tx.delete(counts).where(eq(counts.teamId, id));
        await tx.delete(queries).where(eq(queries.teamId, id));
        await tx.delete(breakdowns).where(eq(breakdowns.teamId, id));
        // Team assignments
        await tx.delete(teamAssignments).where(eq(teamAssignments.teamId, id));
        // Unassign items
        await tx.update(items).set({ teamId: null }).where(eq(items.teamId, id));
        // Delete the team
        await tx.delete(teams).where(eq(teams.id, id));
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
