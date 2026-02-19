import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { execMessages, executives, admins, supervisors } from "@/lib/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "executive" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const supervisorId = searchParams.get("supervisorId");

  if (supervisorId) {
    // Get all messages for a specific supervisor thread
    const messages = await db
      .select()
      .from(execMessages)
      .where(eq(execMessages.supervisorId, Number(supervisorId)))
      .orderBy(execMessages.createdAt);

    // Resolve sender names
    const execIds = Array.from(new Set(messages.filter((m) => m.senderType === "executive").map((m) => m.senderId)));
    const adminIds = Array.from(new Set(messages.filter((m) => m.senderType === "admin").map((m) => m.senderId)));
    const supIds = Array.from(new Set(messages.filter((m) => m.senderType === "supervisor").map((m) => m.senderId)));

    const execNames = execIds.length > 0
      ? await db.select({ id: executives.id, name: executives.name }).from(executives).where(inArray(executives.id, execIds))
      : [];
    const adminNames = adminIds.length > 0
      ? await db.select({ id: admins.id, name: admins.name }).from(admins).where(inArray(admins.id, adminIds))
      : [];
    const supNames = supIds.length > 0
      ? await db.select({ id: supervisors.id, name: supervisors.name }).from(supervisors).where(inArray(supervisors.id, supIds))
      : [];

    const nameMap = new Map<string, string>();
    execNames.forEach((e) => nameMap.set(`executive:${e.id}`, e.name));
    adminNames.forEach((a) => nameMap.set(`admin:${a.id}`, a.name));
    supNames.forEach((s) => nameMap.set(`supervisor:${s.id}`, s.name));

    const resolved = messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderType: m.senderType,
      senderName: nameMap.get(`${m.senderType}:${m.senderId}`) || "Unknown",
      message: m.message,
      createdAt: m.createdAt,
    }));

    return NextResponse.json({ messages: resolved });
  }

  // Get threads: grouped by supervisor with last message
  const threads = await db.execute(
    sql`SELECT
          em.supervisor_id,
          s.name as supervisor_name,
          se.name as event_name,
          se.id as event_id,
          (SELECT message FROM exec_messages em2 WHERE em2.supervisor_id = em.supervisor_id ORDER BY em2.created_at DESC LIMIT 1) as last_message,
          (SELECT sender_type FROM exec_messages em2 WHERE em2.supervisor_id = em.supervisor_id ORDER BY em2.created_at DESC LIMIT 1) as last_sender_type,
          (SELECT created_at FROM exec_messages em2 WHERE em2.supervisor_id = em.supervisor_id ORDER BY em2.created_at DESC LIMIT 1) as last_message_at,
          COUNT(*) as message_count
        FROM exec_messages em
        INNER JOIN supervisors s ON s.id = em.supervisor_id
        INNER JOIN stocktake_events se ON se.id = em.event_id
        GROUP BY em.supervisor_id, s.name, se.name, se.id
        ORDER BY last_message_at DESC`
  );

  return NextResponse.json({ threads });
}

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "executive" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { supervisorId, eventId, message } = await request.json();

    if (!supervisorId || !eventId || !message?.trim()) {
      return NextResponse.json({ error: "supervisorId, eventId, and message are required" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(execMessages)
      .values({
        senderId: user.id,
        senderType: user.type,
        supervisorId: Number(supervisorId),
        eventId: Number(eventId),
        message: message.trim(),
      })
      .returning({ id: execMessages.id });

    return NextResponse.json({ success: true, messageId: inserted.id });
  } catch (error) {
    console.error("Send exec message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
