import { db } from "@/lib/db";
import { stocktakeEvents } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * Fallback event for admin/executive views when no eventId was given.
 * Prefers an active event, then the most recent completed or locked one.
 * Setup events are never picked: they have no counts to report or export.
 */
export async function pickDefaultReportEventId(): Promise<number | null> {
  const [row] = await db
    .select({ id: stocktakeEvents.id })
    .from(stocktakeEvents)
    .where(sql`${stocktakeEvents.status} IN ('active', 'completed', 'locked')`)
    .orderBy(
      sql`CASE WHEN ${stocktakeEvents.status} = 'active' THEN 0 ELSE 1 END`,
      sql`${stocktakeEvents.id} DESC`,
    )
    .limit(1);
  return row?.id ?? null;
}
