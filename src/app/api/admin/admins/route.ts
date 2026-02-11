import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { admins } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

function getAdminUser(request: NextRequest) {
  const id = request.headers.get("x-user-id");
  const type = request.headers.get("x-user-type");
  if (!id || type !== "admin") return null;
  return { id: Number(id) };
}

// GET: List all admins (no password hashes)
export async function GET(request: NextRequest) {
  const user = getAdminUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allAdmins = db
    .select({
      id: admins.id,
      name: admins.name,
      createdAt: admins.createdAt,
    })
    .from(admins)
    .all();

  return NextResponse.json({ admins: allAdmins });
}

// POST: Create a new admin
export async function POST(request: NextRequest) {
  const user = getAdminUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, password } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ error: "Name and password required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db
      .insert(admins)
      .values({ name, passwordHash: hash, createdBy: user.id })
      .run();

    return NextResponse.json({
      success: true,
      admin: { id: Number(result.lastInsertRowid), name },
    });
  } catch (error) {
    console.error("Create admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: Remove an admin by id
export async function DELETE(request: NextRequest) {
  const user = getAdminUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Admin id required" }, { status: 400 });
    }

    // Can't delete yourself
    if (id === user.id) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    // Atomic check-and-delete inside a transaction to prevent race conditions
    const result = db.transaction((tx) => {
      const count = tx
        .select({ count: sql<number>`count(*)` })
        .from(admins)
        .get();

      if ((count?.count || 0) <= 1) {
        return { error: "Cannot delete the last admin" } as const;
      }

      tx.delete(admins).where(eq(admins.id, id)).run();
      return { success: true } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
