// One colour scheme + wording for event statuses, used everywhere in the admin area.
// Pure (no JSX) so it can be unit-tested and used in server code.

import { EVENT_STATUSES, type EventStatus } from "@/lib/event-status";

export interface StatusMeta {
  status: string;
  /** Short badge text, e.g. "In setup". */
  label: string;
  /** One sentence: what this status means for the people using the app. */
  description: string;
  /** Badge classes (background, text, ring). */
  badgeClass: string;
  /** Small dot colour for compact lists. */
  dotClass: string;
  /** Lifecycle position 0-3 (setup, active, completed, locked); -1 when unknown. */
  order: number;
}

const META: Record<EventStatus, Omit<StatusMeta, "status" | "order">> = {
  setup: {
    label: "In setup",
    description:
      "Being prepared. Import stock, add people and assign bins. Teams cannot log in to count yet.",
    badgeClass: "bg-blue-50 text-blue-700 ring-blue-600/20",
    dotClass: "bg-blue-500",
  },
  active: {
    label: "Live",
    description:
      "Counting is open. Teams count their bins and supervisors review variances. The stock file can no longer be replaced.",
    badgeClass: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  completed: {
    label: "Completed",
    description:
      "Counting has stopped. Results are ready for review and export, and supervisors have read-only access. Lock it once exports are done.",
    badgeClass: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    dotClass: "bg-indigo-500",
  },
  locked: {
    label: "Locked",
    description:
      "Closed and archived. Nothing can change; results and exports stay available. An admin can reopen it for counting if needed.",
    badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
};

/** Badge label, colours and explanation for an event status. Unknown values get a neutral badge. */
export function statusMeta(status: string | null | undefined): StatusMeta {
  const s = (status ?? "").toLowerCase();
  const order = (EVENT_STATUSES as readonly string[]).indexOf(s);
  if (order >= 0) return { status: s, order, ...META[s as EventStatus] };
  const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
  return {
    status: s,
    label,
    description: "Unrecognised status.",
    badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20",
    dotClass: "bg-slate-400",
    order: -1,
  };
}
