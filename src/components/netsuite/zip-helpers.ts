/** Pure helpers for the admin NetSuite export ZIP (kept separate so they can be unit tested). */

export function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim();
}

/**
 * One ZIP folder name per event. Names are sanitized, so different events can end up
 * with the same folder ("Stock/Take" and "Stock_Take", or two events with the same
 * name); those collisions (case-insensitive, as on Windows) get the event id appended
 * so no event's files overwrite another's.
 */
export function uniqueFolderNames(events: { id: number; name: string }[]): Map<number, string> {
  const base = new Map<number, string>();
  const uses = new Map<string, number>();
  for (const e of events) {
    const name = sanitizeFolderName(e.name) || `event_${e.id}`;
    base.set(e.id, name);
    const key = name.toLowerCase();
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const result = new Map<number, string>();
  const taken = new Set<string>();
  for (const e of events) {
    const name = base.get(e.id)!;
    let folder = (uses.get(name.toLowerCase()) ?? 0) > 1 ? `${name}_${e.id}` : name;
    // An appended id could still clash with another event's literal name ("A_2" vs "A" #2)
    let n = 2;
    while (taken.has(folder.toLowerCase())) folder = `${name}_${e.id}_${n++}`;
    taken.add(folder.toLowerCase());
    result.set(e.id, folder);
  }
  return result;
}

export type ExportFetchOutcome = "ok" | "empty" | "error";

/**
 * Classify a /api/supervisor/export response. The route answers a genuinely empty
 * variance file with a plain-text 404 "No data"; any other non-OK status (auth, missing
 * event, server error) is a failure that must not be mistaken for "no variances".
 */
export function classifyExportResponse(status: number, bodyText: string | null): ExportFetchOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 && (bodyText ?? "").trim() === "No data") return "empty";
  return "error";
}
