// Admin URL map and legacy-URL redirects. Pure: safe to import from proxy.ts, server and client code.

import { parseId } from "./ids";

export const EVENT_TABS = ["overview", "items", "people", "bins", "results", "exports"] as const;
export type EventTab = (typeof EVENT_TABS)[number];

/** Setup wizard steps, in order. The slug is the URL segment: /admin/events/[id]/setup/[step]. */
export const SETUP_STEPS = ["details", "items", "warehouses", "people", "bins", "review"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Short stepper labels for the setup wizard. */
export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  details: "Details",
  items: "Stock file",
  warehouses: "Warehouses",
  people: "People",
  bins: "Bins",
  review: "Review & go live",
};

export function isSetupStep(value: string): value is SetupStep {
  return (SETUP_STEPS as readonly string[]).includes(value);
}

export function isEventTab(value: string): value is EventTab {
  return (EVENT_TABS as readonly string[]).includes(value);
}

type Id = number | string;

export const adminRoutes = {
  overview: "/admin",
  events: "/admin/events",
  newEvent: "/admin/events/new",
  exports: "/admin/exports",
  files: "/admin/files",
  accounts: "/admin/accounts",
  /** Help page, optionally at a section anchor (e.g. "import-file"). */
  help: (anchor?: string) => (anchor ? `/admin/help#${anchor}` : "/admin/help"),
  /** Event workspace; tab "overview" is the workspace root. */
  event: (id: Id, tab: EventTab = "overview") =>
    tab === "overview" ? `/admin/events/${id}` : `/admin/events/${id}/${tab}`,
  setup: (id: Id, step: SetupStep) => `/admin/events/${id}/setup/${step}`,
} as const;

/**
 * Is a sidebar item active for the current path? "/admin" (Overview) matches only itself;
 * every other item also matches its nested routes ("/admin/events" matches "/admin/events/12/items").
 */
export function isNavActive(href: string, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (href === "/admin") return path === "/admin";
  return path === href || path.startsWith(`${href}/`);
}

/** Which workspace tab a path under /admin/events/[id] belongs to ("overview" for the root or unknown). */
export function activeEventTab(pathname: string, eventId: number | string): EventTab {
  const root = adminRoutes.event(eventId);
  const path = pathname.replace(/\/+$/, "");
  if (path !== root && !path.startsWith(`${root}/`)) return "overview";
  const segment = path.slice(root.length).split("/")[1] ?? "";
  return isEventTab(segment) ? segment : "overview";
}

/** Old admin page -> new location. `event` is used when a valid ?eventId= is present. */
const LEGACY: Record<string, { plain: string; event?: (id: number) => string }> = {
  "/admin/dashboard": { plain: adminRoutes.overview },
  "/admin/setup": { plain: adminRoutes.events, event: (id) => adminRoutes.event(id) },
  "/admin/import": { plain: adminRoutes.events, event: (id) => adminRoutes.event(id, "items") },
  "/admin/teams": { plain: adminRoutes.events, event: (id) => adminRoutes.event(id, "people") },
  "/admin/teams/assign": { plain: adminRoutes.events, event: (id) => adminRoutes.event(id, "bins") },
  "/admin/activate": { plain: adminRoutes.events, event: (id) => adminRoutes.event(id) },
  "/admin/summary": { plain: adminRoutes.events, event: (id) => adminRoutes.event(id, "results") },
  "/admin/export": { plain: adminRoutes.exports, event: (id) => adminRoutes.event(id, "exports") },
  "/admin/netsuite-export": { plain: adminRoutes.exports },
  "/admin/settings": { plain: adminRoutes.accounts },
};

function eventIdParam(searchParams: URLSearchParams | Record<string, string | string[] | undefined>): number | null {
  let raw: string | string[] | null | undefined;
  if (searchParams instanceof URLSearchParams) raw = searchParams.get("eventId");
  else raw = searchParams.eventId;
  if (Array.isArray(raw)) raw = raw[0];
  return parseId(raw);
}

/**
 * Where an old admin URL now lives, or null when `pathname` is not a legacy admin URL.
 * A valid ?eventId= is carried into the event workspace; other query params are dropped.
 */
export function legacyAdminRedirect(
  pathname: string,
  searchParams: URLSearchParams | Record<string, string | string[] | undefined> = {}
): string | null {
  const path = pathname.replace(/\/+$/, "");
  const entry = LEGACY[path];
  if (!entry) return null;
  const id = entry.event ? eventIdParam(searchParams) : null;
  return id && entry.event ? entry.event(id) : entry.plain;
}
