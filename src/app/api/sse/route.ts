import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { counts, items, teams } from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { verifyToken } from "@/lib/token";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("stocktake-token")?.value;
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload || payload.type !== "supervisor") {
    return new Response("Unauthorized", { status: 401 });
  }

  const eventId = payload.eventId;
  let lastCheckTime = new Date().toISOString();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Send initial heartbeat
      sendEvent("connected", { time: new Date().toISOString() });

      const interval = setInterval(() => {
        try {
          // Check for new counts since last check
          const newCounts = db
            .select({
              teamName: teams.name,
              itemCode: items.itemCode,
              countedQty: counts.countedQty,
              variance: counts.variance,
              isMatch: counts.isMatch,
              countedAt: counts.countedAt,
            })
            .from(counts)
            .innerJoin(teams, eq(counts.teamId, teams.id))
            .innerJoin(items, eq(counts.itemId, items.id))
            .where(
              and(
                eq(counts.eventId, eventId),
                sql`counted_at > ${lastCheckTime}`
              )
            )
            .orderBy(desc(counts.countedAt))
            .limit(10)
            .all();

          if (newCounts.length > 0) {
            sendEvent("counts", newCounts);
            lastCheckTime = new Date().toISOString();
          }

          // Overall progress
          const totalItems = db
            .select({ count: sql<number>`count(*)` })
            .from(items)
            .where(eq(items.eventId, eventId))
            .get();

          const totalCounted = db
            .select({ count: sql<number>`count(*)` })
            .from(counts)
            .where(eq(counts.eventId, eventId))
            .get();

          const total = totalItems?.count || 0;
          const counted = totalCounted?.count || 0;

          sendEvent("progress", {
            total,
            counted,
            progressPercent:
              total > 0 ? Math.round((counted / total) * 100) : 0,
          });
        } catch {
          // DB error, skip this tick
        }
      }, 3000);

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
