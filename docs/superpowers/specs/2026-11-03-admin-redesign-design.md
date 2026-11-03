# Admin area redesign (V2)

Owner request: "the backend still feels very messy.. re-design it to look professional.. remove what does
not make sense and fix things that are messy.. make the setup process as painless as possible.. detailed
user friendly wizard with tutorials." Owner opted out of questions; every decision below is the builder's call.

## Problems with today's admin (from the audit)
- Top tab nav with 6 items; Import / Teams / Assign / Activate pages are reachable only from buttons on event
  cards. `/admin/summary` and `/admin/export` are one-line re-exports of other areas' pages (export is orphaned).
- Setup is split across a 1600-line wizard (`/admin/setup`) and four separate pages that duplicate it with
  different features. The wizard has no bin-assignment step (activation needs 100% assigned), can't be
  resumed, has no file-format guidance, no bulk/Excel team creation, no PIN view/edit.
- Status changes live in two places with two APIs and different rules; confirmations mix `window.confirm`
  and dialogs; status badge colours differ per page; the dashboard hides setup/locked events and calls
  every non-active event "Completed"; it's titled "Executive Dashboard".
- No way to edit event details, no way for anyone to create auditors from the UI.
- Supervisor layout renders `{children}` twice (every supervisor page mounts and fetches twice).

## Goals
1. Professional, consistent look: one admin shell, one set of shared building blocks, one status colour scheme.
2. Event-centred structure: everything about one event lives in one workspace.
3. Painless setup: a resumable, step-by-step wizard with built-in guidance on every step, that gets a
   first-time admin from nothing to a live stocktake without leaving it.
4. Remove duplicates and dead ends; keep every old URL working via redirects.

Non-goals: no changes to the team counting app, supervisor review workflow or database schema (beyond what's
listed); no new UI framework (stay on Next 16 + Tailwind + existing shadcn/Radix components + lucide + sonner);
no dark mode.

Anti-goals: losing any capability that exists today; breaking old bookmarks; a wizard that traps the user
(every step can be left and resumed later, and every step links to its full workspace tab).

## Information architecture
Sidebar shell (desktop: fixed left sidebar; mobile: top bar + slide-out Sheet), header shows current page
title, user name and logout.

Sidebar:
- **Overview** `/admin` (dashboard)
- **Events** `/admin/events`
- **Exports** `/admin/exports`
- **Files** `/admin/files`
- **Accounts** `/admin/accounts` (admins + executives)
- **Help & guide** `/admin/help`

### Overview `/admin`
- No events: a welcome / getting-started card explaining the 5 phases (Set up → Go live → Count → Review →
  Close & export) with a big "Create your first stocktake" button.
- Otherwise: summary tiles (events by status), then event cards grouped: **Live now** (progress, matched /
  variance / pending, over/under/net value, open queries/breakdowns/serial badges, last activity),
  **In setup** (setup checklist progress + "Continue setup" button that resumes the wizard at the right step),
  **Finished** (completed/locked, links to results & exports). Auto-refresh live data every 15s.
  Server: `GET /api/admin/dashboard` must include setup and locked events and their real status.

### Events `/admin/events`
Table/list of all events: name, location, dates, status badge, items, teams, progress. Filter by status,
search. "New stocktake" button → wizard. Row click → workspace.

### Event workspace `/admin/events/[id]`
Header: name, location, dates, status badge, primary next action (contextual: "Continue setup" / "Go live" /
"Mark complete" / "Lock" / "Reopen"), and an actions menu (edit details, reset, delete, download imported
items). Tabs (URL segment, e.g. `/admin/events/12/items`):
- **Overview**: lifecycle stepper (Setup → Live → Completed → Locked) showing where the event is and what each
  transition means; readiness checklist while in setup (each line links to the tab that fixes it); live KPIs
  when active; all status transitions with clear dialogs explaining consequences.
- **Items**: import / replace (upload or copy from event) with the column-mapping report, warehouse selection
  (editable in setup), item stats, download imported items. Read-only after setup with an explanation.
- **People**: teams (add, bulk, Excel import, edit, PIN reveal), supervisors, auditors (admin can add auditors).
- **Bins**: assignment (the full version with per-team filters, counted badges, reassign, auto-balance).
- **Results**: the completed-summary content (overall, team results, top variances) — available once live.
- **Exports**: all export files for this event (NetSuite files + full report ZIP) with what each file is for.

### Setup wizard `/admin/events/new` then `/admin/events/[id]/setup/[step]`
Steps (URL-driven, resumable, step state derived from server data, clickable stepper for steps already
reachable):
1. **Details** – name, location, dates. Creating the event moves to `/admin/events/[id]/setup/items`.
   Coming back edits the details (server: `PUT /api/admin/events` accepts name/location/startDate/endDate
   while in setup... and later; validate).
2. **Stock file** – upload NetSuite export or copy from a previous event. Guidance: which NetSuite saved
   search/columns are expected, accepted formats, size limit, downloadable sample CSV, what happens with
   blank warehouse/bin, comma thousands separators. Shows mapping report (recognised vs ignored columns)
   and summary.
3. **Warehouses** – choose which warehouses are in scope (skipped automatically when only one).
4. **People** – teams (bulk create + Excel import highlighted for large events), supervisors (at least one
   required), auditors (optional). Explains each role, PIN rules (4–6 digits), and how people log in.
5. **Bins** – assign every bin to a team, with "Auto-balance across all teams" as the recommended one-click
   option and manual adjustment below. Shows remaining unassigned count.
6. **Review & go live** – checklist with links back to steps, a "what happens when you go live" explainer
   (teams can start counting, imports locked, etc.), printable/copyable login sheet (team names + PINs +
   site URL) for handing out, and the Go live button.

Every step has a **guide panel** (right column on desktop, collapsible "How this step works" on mobile):
plain-language explanation, numbered what-to-do list, tips/common mistakes, and a "Learn more" link to the
relevant Help section. Footer: Back / "Save & exit" / Continue. Continue is disabled with an inline reason
when the step isn't done (except optional steps).

### Exports `/admin/exports`
NetSuite multi-event ZIP (existing page, restyled) plus explanations of each file; links to per-event exports.

### Help `/admin/help`
Full illustrated-by-text guide: the lifecycle, roles (admin / supervisor / auditor / team / executive), the
import file format, assigning bins, running the count day, reviewing variances, closing and exporting to
NetSuite, FAQ & troubleshooting. Sections have anchors the wizard guide panels link to.

### Accounts `/admin/accounts`
Admin and executive accounts (existing settings page, restyled, dialog confirms).

## Removed / redirected
`/admin/dashboard` → `/admin`; `/admin/setup` → `/admin/events`; `/admin/import?eventId=X` →
`/admin/events/X/items`; `/admin/teams?eventId=X` → `/admin/events/X/people`; `/admin/teams/assign?eventId=X`
→ `/admin/events/X/bins`; `/admin/activate?eventId=X` → `/admin/events/X`; `/admin/summary?eventId=X` →
`/admin/events/X/results`; `/admin/export` → `/admin/exports`; `/admin/netsuite-export` → `/admin/exports`;
`/admin/settings` → `/admin/accounts`. Without eventId → `/admin/events`. Update every in-app link
(login redirect in `src/app/page.tsx`, `proxy.ts` role gating, completed layout back button, etc.).

## Shared building blocks (`src/components/admin/`)
`AdminShell`/sidebar, `PageHeader` (title, description, actions, breadcrumbs), `StatusBadge` (one colour per
status: setup=slate/blue, active=green, completed=amber/indigo, locked=gray), `ConfirmDialog` (replaces every
`window.confirm` in admin + TeamsManager; supports typed confirmation for destructive actions), `EmptyState`,
`StatCard`, `GuidePanel` + `GuideSection` (tutorial content), `useAdminEvent(id)` hook/context for the
workspace, `formatMoney` (R), consistent loading skeletons and error states with retry.
Tutorial copy lives in one module (`src/components/admin/guide-content.ts(x)`) so wizard panels and the Help
page share text.

## Server changes in scope
- `PUT /api/admin/events`: accept name/location/startDate/endDate edits (validated; any status).
- `GET /api/admin/dashboard`: include setup + locked events with real status and setup-progress counts.
- Admin assign page uses the full assignment features (filters, reassign) that supervisors already have.
- Admin can create auditors (API already allows admin).
- Fix supervisor layout double render.
- Keep both status-transition APIs working, but the UI uses one consistent path per transition.

## Quality bar
Typecheck, lint (no new warnings), all Vitest tests pass; new pure helpers tested (step derivation,
redirect mapping, status badge map); local Docker E2E passes; manual browser walk-through of the wizard
on a local instance.
