import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { counts, items, teams, stocktakeEvents } from "@/lib/db/schema";
import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
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

  const MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes max connection
  const POLL_INTERVAL_MS = 10_000; // 10 seconds between polls
  const startTime = Date.now();

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

      const interval = setInterval(async () => {
        try {
          // Auto-close after max duration
          if (Date.now() - startTime > MAX_DURATION_MS) {
            sendEvent("timeout", { message: "Connection expired, please reconnect" });
            clearInterval(interval);
            controller.close();
            return;
          }

          // Check if event is still active
          const [event] = await db
            .select({ status: stocktakeEvents.status })
            .from(stocktakeEvents)
            .where(eq(stocktakeEvents.id, eventId));

          if (!event || event.status === "completed" || event.status === "locked") {
            sendEvent("event-closed", { message: "Event has been completed or locked" });
            clearInterval(interval);
            controller.close();
            return;
          }

          // Check for new counts since last check
          const newCounts = await db
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
                eq(counts.countType, "initial"),
                sql`counted_at > ${lastCheckTime}`
              )
            )
            .orderBy(desc(counts.countedAt))
            .limit(10);

          if (newCounts.length > 0) {
            sendEvent("counts", newCounts);
            // Use the max countedAt from results to avoid missing slow-committing counts
            lastCheckTime = newCounts[0].countedAt;
          }

          // Overall progress (only assigned items)
          const [totalItems] = await db
            .select({ count: sql<number>`count(*)` })
            .from(items)
            .where(and(eq(items.eventId, eventId), isNotNull(items.teamId)));

          const [totalCounted] = await db
            .select({ count: sql<number>`count(*)` })
            .from(counts)
            .where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial")));

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
      }, POLL_INTERVAL_MS);

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
