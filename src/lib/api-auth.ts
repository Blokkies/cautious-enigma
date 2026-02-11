import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface ApiUser {
  id: number;
  type: "team" | "supervisor" | "admin";
  name: string;
  eventId: number;
}

export function getApiUser(request: NextRequest): ApiUser | null {
  const id = request.headers.get("x-user-id");
  const type = request.headers.get("x-user-type") as ApiUser["type"];
  const name = request.headers.get("x-user-name");
  const eventId = request.headers.get("x-event-id");

  if (!id || !type || !name || !eventId) return null;

  return {
    id: Number(id),
    type,
    name: name || "",
    eventId: Number(eventId),
  };
}

/**
 * Check if an event is still accepting write operations (counts, queries, breakdowns).
 * Returns null if the event is active, or an error string if it's locked/completed.
 */
export function checkEventActive(eventId: number): string | null {
  const event = db
    .select({ status: stocktakeEvents.status })
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eventId))
    .get();

  if (!event) return "Event not found";
  if (event.status === "completed" || event.status === "locked") {
    return "This stocktake has been completed. No further changes are allowed.";
  }
  if (event.status === "setup") {
    return "This stocktake has not been activated yet.";
  }
  return null; // active — all good
}
