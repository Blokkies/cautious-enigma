import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { admins } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/api-auth";
import { parseId } from "@/lib/ids";

/**
 * Admins log in with a password only (no username), so the password is what
 * identifies the account: two admins sharing a password would make login
 * ambiguous. True if `password` matches any existing admin's hash.
 */
async function passwordInUse(
  executor: Pick<typeof db, "select">,
  password: string
): Promise<boolean> {
  const existing = await executor.select({ passwordHash: admins.passwordHash }).from(admins);
  for (const admin of existing) {
    if (await bcrypt.compare(password, admin.passwordHash)) return true;
  }
  return false;
}

// GET: List all admins (no password hashes)
export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401 });
  if (auth.response) return auth.response;

  const allAdmins = await db
    .select({
      id: admins.id,
      name: admins.name,
      createdAt: admins.createdAt,
    })
    .from(admins);

  return NextResponse.json({ admins: allAdmins });
}

// POST: Create a new admin
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const { name, password } = await request.json();

    if (!name || !password || typeof name !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Name and password required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 10);

    // Check-then-insert under a transaction-scoped advisory lock so two
    // concurrent creates with the same password cannot both pass the check.
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('admins:create'))`);
      if (await passwordInUse(tx, password)) return null;
      const [row] = await tx
        .insert(admins)
        .values({ name, passwordHash: hash, createdBy: user.id })
        .returning({ id: admins.id });
      return row;
    });

    if (!result) {
      return NextResponse.json(
        { error: "Another admin already uses this password. Choose a different one." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      admin: { id: result.id, name },
    });
  } catch (error) {
    console.error("Create admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: Remove an admin by id
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const { id: rawId } = await request.json();

    if (rawId === undefined || rawId === null || rawId === "") {
      return NextResponse.json({ error: "Admin id required" }, { status: 400 });
    }
    // A string id ("2") must not slip past the self-delete check below.
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid admin id" }, { status: 400 });
    }

    // Can't delete yourself
    if (id === user.id) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    // Lock every admin row (SELECT ... FOR UPDATE) before counting, so two
    // concurrent deletes serialize: the second sees the first one's result and
    // can never remove the last remaining admin.
    const result = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: admins.id }).from(admins).for("update");

      if (!rows.some((r) => r.id === id)) {
        return { error: "Admin not found", status: 404 } as const;
      }
      if (rows.length <= 1) {
        return { error: "Cannot delete the last admin", status: 400 } as const;
      }

      await tx.delete(admins).where(eq(admins.id, id));
      return { success: true } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
