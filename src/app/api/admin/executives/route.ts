import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { executives } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/api-auth";
import { countInt } from "@/lib/db/aggregates";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401 });
  if (auth.response) return auth.response;

  const allExecs = await db
    .select({
      id: executives.id,
      name: executives.name,
      createdAt: executives.createdAt,
    })
    .from(executives);

  return NextResponse.json({ executives: allExecs });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const { name, password } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ error: "Name and password required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db
      .insert(executives)
      .values({ name, passwordHash: hash, createdBy: user.id })
      .returning({ id: executives.id });

    return NextResponse.json({
      success: true,
      executive: { id: result.id, name },
    });
  } catch (error) {
    console.error("Create executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401, write: true });
  if (auth.response) return auth.response;

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Executive id required" }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [count] = await tx
        .select({ count: countInt() })
        .from(executives);

      if ((count?.count || 0) <= 1) {
        return { error: "Cannot delete the last executive" } as const;
      }

      await tx.delete(executives).where(eq(executives.id, id));
      return { success: true } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
