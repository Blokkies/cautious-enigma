// Pure helpers for the admin Overview and Events list: grouping, filtering and small
// display calculations. No JSX, no fetches, so they are unit-tested.

import { SETUP_STEPS, type SetupStep } from "@/lib/admin-routes";
import { setupProgress, type SetupCounts, type SetupProgress } from "@/lib/setup-progress";
import { statusMeta } from "./status";

/** One event as returned by GET /api/admin/dashboard. */
export interface DashboardEvent {
  id: number;
  name: string;
  location: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  totalItems: number;
  countedItems: number;
  matchedItems: number;
  varianceItems: number;
  varianceValue: number;
  overCount: number;
  overValue: number;
  underCount: number;
  underValue: number;
  netVarianceValue: number;
  progressPercent: number;
  teamCount: number;
  supervisorCount: number;
  openQueries: number;
  pendingBreakdowns: number;
  openSerialDiscrepancies: number;
  lastCountAt: string | null;
  /** Setup checklist counts (setup events only). */
  setup: SetupCounts | null;
}

/** One event as returned by GET /api/admin/events (only the fields the list uses). */
export interface EventListItem {
  id: number;
  name: string;
  location: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  createdAt?: string | null;
  /** All imported items. */
  totalItemCount: number;
  /** Items assigned to a team. */
  itemCount: number;
  teamCount: number;
  supervisorCount: number;
}

export interface GroupedEvents<T> {
  live: T[];
  setup: T[];
  /** Completed and locked. */
  finished: T[];
  /** Any status this build doesn't know. Shown with the finished ones. */
  other: T[];
}

/**
 * Split events into the Overview sections. Live events are ordered by least progress first
 * (they need the most attention), setup events newest first, finished events completed
 * before locked and then newest first.
 */
export function groupEvents<T extends { id: number; status: string; progressPercent?: number }>(
  events: T[]
): GroupedEvents<T> {
  const groups: GroupedEvents<T> = { live: [], setup: [], finished: [], other: [] };
  for (const e of events) {
    switch (e.status) {
      case "active":
        groups.live.push(e);
        break;
      case "setup":
        groups.setup.push(e);
        break;
      case "completed":
      case "locked":
        groups.finished.push(e);
        break;
      default:
        groups.other.push(e);
    }
  }
  groups.live.sort((a, b) => (a.progressPercent ?? 0) - (b.progressPercent ?? 0) || b.id - a.id);
  groups.setup.sort((a, b) => b.id - a.id);
  groups.finished.sort((a, b) => statusMeta(a.status).order - statusMeta(b.status).order || b.id - a.id);
  return groups;
}

export type StatusCounts = Record<"setup" | "active" | "completed" | "locked" | "total", number>;

export function countByStatus(events: { status: string }[]): StatusCounts {
  const counts: StatusCounts = { setup: 0, active: 0, completed: 0, locked: 0, total: events.length };
  for (const e of events) {
    if (e.status === "setup" || e.status === "active" || e.status === "completed" || e.status === "locked") {
      counts[e.status]++;
    }
  }
  return counts;
}

export const STATUS_FILTERS = ["all", "setup", "active", "completed", "locked"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function isStatusFilter(value: string | null | undefined): value is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value ?? "");
}

/**
 * Events matching a status filter and a free-text search over name and location
 * (case-insensitive, every word must match). Ordered by lifecycle (setup, live, completed,
 * locked) and then newest first.
 */
export function filterEvents<T extends { id: number; name: string; location: string | null; status: string }>(
  events: T[],
  status: StatusFilter,
  query: string
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return events
    .filter((e) => status === "all" || e.status === status)
    .filter((e) => {
      if (words.length === 0) return true;
      const hay = `${e.name} ${e.location ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => {
      // Live first: it is the one an admin most likely wants to open.
      const rank = (s: string) => (s === "active" ? 0 : s === "setup" ? 1 : s === "completed" ? 2 : s === "locked" ? 3 : 4);
      return rank(a.status) - rank(b.status) || b.id - a.id;
    });
}

export interface SetupChecklist extends SetupProgress {
  /** Steps that count toward progress (everything but the final review). */
  total: number;
  completed: number;
  percent: number;
}

/** Setup progress plus "3 of 5 steps done" numbers for a progress bar. */
export function setupChecklist(counts: SetupCounts): SetupChecklist {
  const progress = setupProgress(counts);
  const steps = SETUP_STEPS.filter((s): s is Exclude<SetupStep, "review"> => s !== "review");
  const completed = steps.filter((s) => progress.done[s]).length;
  return {
    ...progress,
    total: steps.length,
    completed,
    percent: Math.round((completed / steps.length) * 100),
  };
}

/**
 * Parse a database timestamp. Postgres text timestamps look like
 * "2026-11-03 10:15:22.123+00"; client-written ones are ISO. A value without a zone is UTC.
 * Returns null for anything unparseable.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  let s = value.trim().replace(" ", "T");
  // "+00" / "+0200" -> "+00:00" / "+02:00"
  s = s.replace(/([+-]\d{2})(\d{2})?$/, (_m, h: string, m?: string) => `${h}:${m ?? "00"}`);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago"; "" when unknown. */
export function timeAgo(value: string | null | undefined, now: Date = new Date()): string {
  const d = parseTimestamp(value);
  if (!d) return "";
  const secs = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Safe file name for an event's report ZIP. */
export function eventZipName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_");
  return `${safe || "stocktake"}_all_exports.zip`;
}
