import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { execMessages, executives, admins } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "auditor" && user.type !== "executive")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await db
    .select()
    .from(execMessages)
    .where(eq(execMessages.supervisorId, user.id))
    .orderBy(execMessages.createdAt);

  // Resolve sender names
  const execIds = Array.from(new Set(messages.filter((m) => m.senderType === "executive").map((m) => m.senderId)));
  const adminIds = Array.from(new Set(messages.filter((m) => m.senderType === "admin").map((m) => m.senderId)));

  const execNames = execIds.length > 0
    ? await db.select({ id: executives.id, name: executives.name }).from(executives).where(inArray(executives.id, execIds))
    : [];
  const adminNames = adminIds.length > 0
    ? await db.select({ id: admins.id, name: admins.name }).from(admins).where(inArray(admins.id, adminIds))
    : [];

  const nameMap = new Map<string, string>();
  execNames.forEach((e) => nameMap.set(`executive:${e.id}`, e.name));
  adminNames.forEach((a) => nameMap.set(`admin:${a.id}`, a.name));

  const resolved = messages.map((m) => ({
    id: m.id,
    senderId: m.senderId,
    senderType: m.senderType,
    senderName: m.senderType === "supervisor"
      ? user.name
      : (nameMap.get(`${m.senderType}:${m.senderId}`) || "Unknown"),
    message: m.message,
    createdAt: m.createdAt,
  }));

  return NextResponse.json({ messages: resolved });
}

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "auditor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { message } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(execMessages)
      .values({
        senderId: user.id,
        senderType: "supervisor",
        supervisorId: user.id,
        eventId: user.eventId,
        message: message.trim(),
      })
      .returning({ id: execMessages.id });

    return NextResponse.json({ success: true, messageId: inserted.id });
  } catch (error) {
    console.error("Supervisor exec message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
