# Admin building blocks

Shared pieces for everything under `/admin`. Design spec: `docs/superpowers/specs/2026-11-03-admin-redesign-design.md`.

## Look and feel

Restrained SaaS admin, light theme only.

- **Surfaces:** page `bg-slate-50`, cards `bg-white border border-slate-200 rounded-lg`. No shadows.
- **Text:** `text-slate-900` for headings and values, `text-slate-600` for body, `text-slate-500` for meta and labels.
- **Accent:** `primary` (the existing blue) is the only accent. Use it for the active state, the main button and links.
- **Status colours:** only through `StatusBadge` / `statusMeta`. Setup is blue, live is emerald, completed is indigo, locked is slate.
- **Semantic tones:** emerald for positive/matched, red for negative/under/errors, amber for warnings/over.
- **Type scale:** page title `text-xl sm:text-2xl font-semibold tracking-tight`, section title `text-base font-semibold`, body `text-sm`, meta `text-xs`. Use `tabular-nums` for numbers.
- **Spacing:** `space-y-6` between page sections, `gap-3` in stat grids, `p-4`/`p-5` inside cards.
- **Money:** use `formatMoney` from `@/lib/format`. Don't write `"R" + toLocaleString()`.
- **Confirmations:** use `useConfirm()` or `ConfirmDialog`. Never call `window.confirm`.

## Route map

| URL | File | State after phase 1 |
| --- | --- | --- |
| `/admin` | `src/app/admin/page.tsx` | Overview: welcome card when empty, status tiles, Live now / In setup / Finished groups, 15s refresh |
| `/admin/events` | `src/app/admin/events/page.tsx` | Events table (cards on mobile) with status filter and search, kept in `?status=` and `?q=` |
| `/admin/events/new` | `src/app/admin/events/new/page.tsx` | Wizard step 1: details form, creates the event and continues at `setup/items` |
| `/admin/events/[id]/setup/[step]` | `src/app/admin/events/[id]/setup/[step]/page.tsx` | Wizard steps (details, items, warehouses, people, bins, review) built from the panels. Step state comes from readiness counts; non-setup events get an "already live" screen. Unknown step returns 404 |
| `/admin/events/[id]` | `(workspace)/page.tsx` | Overview tab: lifecycle stepper, readiness checklist + Continue setup (setup) or KPIs (live/finished), `LifecycleActions` |
| `/admin/events/[id]/items` | `(workspace)/items/page.tsx` | `ItemsPanel` + `WarehousesPanel` |
| `/admin/events/[id]/people` | `(workspace)/people/page.tsx` | `PeoplePanel` + `LoginSheet` |
| `/admin/events/[id]/bins` | `(workspace)/bins/page.tsx` | `BinsPanel` |
| `/admin/events/[id]/results` | `(workspace)/results/page.tsx` | Shared completed summary (`components/completed/completed-dashboard.tsx`), pinned to the event |
| `/admin/events/[id]/exports` | `(workspace)/exports/page.tsx` | Shared export screen (`components/export/export-page-content.tsx`), pinned to the event |
| `/admin/exports` | `src/app/admin/exports/page.tsx` | NetSuite multi-event export (moved from `/admin/netsuite-export`) |
| `/admin/files` | `src/app/admin/files/page.tsx` | Uploaded files |
| `/admin/accounts` | `src/app/admin/accounts/page.tsx` | Admin and executive accounts (moved from `/admin/settings`, now uses `useConfirm`) |
| `/admin/help` | `src/app/admin/help/page.tsx` | Full guide. Setup sections reuse `guide-content.ts`; Help-only copy lives in `help-content.tsx` |

`src/app/admin/events/[id]/layout.tsx` wraps every event route in `AdminEventProvider`. The `(workspace)` route group adds the workspace header and tabs. The wizard sits outside that group, so it is not nested inside the tabs.

**Build URLs with `adminRoutes`** from `@/lib/admin-routes`. Don't hand-write them.

```ts
adminRoutes.overview / .events / .newEvent / .exports / .files / .accounts
adminRoutes.help("import-file")      // "/admin/help#import-file"
adminRoutes.event(12)                // "/admin/events/12"
adminRoutes.event(12, "bins")        // "/admin/events/12/bins"
adminRoutes.setup(12, "people")      // "/admin/events/12/setup/people"
```

The same module also exports:

- `EVENT_TABS` and `EventTab`
- `SETUP_STEPS`, `SetupStep` and `SETUP_STEP_LABELS`
- `isSetupStep` and `isEventTab`
- `isNavActive(href, pathname)`
- `activeEventTab(pathname, id)`
- `legacyAdminRedirect(pathname, searchParams)`

Setup step slugs are `details`, `items` (the stock file), `warehouses`, `people`, `bins` and `review`.

### Old URLs

`src/proxy.ts` redirects old URLs with 307 using `legacyAdminRedirect`. This runs before the auth check, and the target is gated as usual. A valid `?eventId=X` carries over to the event:

- `/admin/dashboard` goes to `/admin`.
- `/admin/setup` goes to `/admin/events`. With an eventId it goes to `/admin/events/X`.
- `/admin/import?eventId=X` goes to `/admin/events/X/items`.
- `/admin/teams?eventId=X` goes to `/admin/events/X/people`.
- `/admin/teams/assign?eventId=X` goes to `/admin/events/X/bins`.
- `/admin/activate?eventId=X` goes to `/admin/events/X`.
- `/admin/summary?eventId=X` goes to `/admin/events/X/results`.
- `/admin/export` goes to `/admin/exports`. With an eventId it goes to `/admin/events/X/exports`.
- `/admin/netsuite-export` goes to `/admin/exports`.
- `/admin/settings` goes to `/admin/accounts`.

If an old URL has no valid eventId, it goes to `/admin/events`. Don't recreate page files at these paths.

## Components

### `AdminShell` (`admin-shell.tsx`)

`<AdminShell>{children}</AdminShell>` is already used by `src/app/admin/layout.tsx`. You never need to render it yourself.

- **Desktop (lg+):** fixed 240px sidebar with the brand, the nav and the user block (name and logout) at the bottom.
- **Mobile:** a top bar showing the current section and a menu button that opens a left `Sheet`.
- **Content area:** `max-w-6xl` with page padding.
- **Nav items:** come from `ADMIN_NAV` in `nav.ts`. Active-state matching includes nested routes. Overview matches only `/admin`.

### `PageHeader` (`page-header.tsx`)

```tsx
<PageHeader
  title="Events"                       // ReactNode
  description="..."                    // optional
  breadcrumbs={[{ label: "Events", href: adminRoutes.events }, { label: "Year end" }]}  // optional; last item has no href
  actions={<Button>New stocktake</Button>}   // optional, right-aligned
  className="mb-0"                     // optional; default margin-bottom is mb-6
>
  {/* optional children under the description (meta line, badges) */}
</PageHeader>
```

Put exactly one `PageHeader` on every page. It renders the page's `h1`.

### `StatusBadge` and `statusMeta` (`status-badge.tsx`, `status.ts`)

```tsx
<StatusBadge status={event.status} size="sm" | "md" showDescription={true} />
```

`statusMeta(status)` is pure. It returns `{ status, label, description, badgeClass, dotClass, order }`.

- **Labels:** setup is "In setup", active is "Live", completed is "Completed" and locked is "Locked".
- **`description`:** a plain-language explanation of what the status means. It also appears as the badge tooltip.
- **`order`:** 0–3 in lifecycle order, or -1 for an unknown status. Use it for the lifecycle stepper.

### `ConfirmDialog` and `useConfirm` (`confirm-dialog.tsx`)

Use the hook for one-off confirmations:

```tsx
const [confirm, confirmDialog] = useConfirm();
// ...
const ok = await confirm({
  title: `Delete "${event.name}"?`,
  description: <p>All counts, teams and assignments are removed. This cannot be undone.</p>,
  confirmLabel: "Delete event",
  destructive: true,
  confirmText: event.name,          // optional: the user must type this exactly
  onConfirm: async () => {          // optional: runs with a spinner and the dialog stays open
    const res = await fetch(...);
    if (!res.ok) throw new Error((await res.json()).error);  // the message shows in the dialog
  },
});
// ok === true once confirmed (and onConfirm succeeded); false if cancelled
return <>{/* page */}{confirmDialog}</>;   // render confirmDialog once
```

The hook needs no provider, so it works on supervisor pages too, for example in `TeamsManager`.

You can also use the controlled `<ConfirmDialog open onOpenChange ...sameOptions />`.

`onConfirm` can keep the dialog open in two ways:

- **Return `false`:** the dialog stays open with no message.
- **Throw:** the dialog stays open and shows the error message.

### `EmptyState` (`empty-state.tsx`)

`<EmptyState icon={Users} title="No teams yet" description="..." action={<Button>Add team</Button>} />` renders a dashed box.

### `StatCard` (`stat-card.tsx`)

```tsx
<StatCard label="Counted" value="1 204" hint="of 1 240 items" icon={CheckCircle2} tone="default|positive|negative|warning" href? />
```

Lay cards out in `grid grid-cols-2 gap-3 lg:grid-cols-4`.

### Loading (`loading-state.tsx`, `ui/skeleton.tsx`)

- `LoadingState({ label? })`: a centered spinner.
- `PageSkeleton`: title, a row of stat cards and a list.
- `StatCardsSkeleton({ count? })`
- `ListSkeleton({ rows? })`
- `Skeleton` (shadcn) for custom shapes.

### `ErrorState` (`error-state.tsx`)

`<ErrorState title? message={error} onRetry={reload} retrying? />`

### Event lists (`event-list.ts`)

Pure helpers used by the Overview and Events pages (tested in `__tests__/event-list.test.ts`):
`DashboardEvent` / `EventListItem` types, `groupEvents` (live / setup / finished), `countByStatus`,
`filterEvents(events, status, query)` with `STATUS_FILTERS`, `setupChecklist(counts)` ("3 of 5 steps" on top of
`setupProgress`), `parseTimestamp` (Postgres text timestamps), `timeAgo` and `eventZipName`.

### Guides (`guide-content.ts`, `guide-panel.tsx`)

`guide-content.ts` is plain data:

- `GuideContent`: `{ id, title, summary, steps[], tips[], mistakes[], reference?: { title, items[] }[], helpAnchor }`
- `SETUP_GUIDES[step]` and `setupGuide(step)`: one guide for each of the six wizard steps, already written from how the import, people, bins and activation APIs work.
- `HELP_SECTIONS`: `{ anchor, title }[]` in reading order. Wizard guides link to `adminRoutes.help(guide.helpAnchor)`.

`guide-panel.tsx` has four ways to render a guide:

- **`<GuideLayout guide={...}>{stepBody}</GuideLayout>`:** use this in wizard steps. It puts a 320px sticky guide column on the right (lg+). On mobile, a collapsible "How this step works" sits above the content.
- **`<GuidePanel guide className? />`:** the panel on its own, if you need a custom layout.
- **`<GuideSection guide />`:** a full Help page section with `id={guide.helpAnchor}`.
- **`<GuideBody guide showSummary? />`:** the bare content.

Edit the copy in `guide-content.ts` only. The wizard and the Help page share it.

### Event context (`event-context.tsx`)

`AdminEventProvider` is mounted by `src/app/admin/events/[id]/layout.tsx`. Read it with `useAdminEvent()` anywhere under `/admin/events/[id]/**`:

```ts
const { eventId, event, loading, error, notFound, reload } = useAdminEvent();
```

- **`event`:** an `AdminEvent` from `GET /api/admin/events`. Its fields are `id`, `name`, `location`, `startDate`, `endDate`, `status`, `createdAt`, `updatedAt` and `uploadId`. It also includes:
  - `warehouses`: the raw JSON.
  - `selectedWarehouses`: the parsed array, or `null` for all warehouses.
  - `totalItemCount`: all items.
  - `itemCount`: assigned items.
  - `teamCount` and `supervisorCount`.
- **`loading`:** true only on the first load.
- **`reload()`:** call it after any change (rename, status change, import, people or bins) so the workspace header updates.

### Workspace (`event-workspace.tsx`)

- `EventWorkspaceFrame({ children, actions? })` is used by the `(workspace)` layout.
  - It handles the loading, error and not-found states.
  - It renders the breadcrumbs, the name with its `StatusBadge`, the location and dates (`EventMeta`) and the `EventTabs`.
  - By default the header shows `WorkspaceActions`: the contextual next step (Continue setup at the right wizard step / Go live once ready / Mark complete / Lock / Reopen) and an Actions menu (edit details, download imported items, the other status change, reset, delete). Pass `actions` to replace it.
- `EventTabs({ eventId })` and `EventMeta({ location, startDate, endDate })` can be used on their own.

## Helpers in `src/lib`

- **`format.ts`:**
  - `formatMoney(v, { decimals = 2, signed })` gives `"R 1 234.56"`, `"-R 50.00"` or `"+R 3.00"`. Use `{ decimals: 0 }` for tiles.
  - `formatNumber(v, dp)` gives `"1 234"`.
  - `formatDate("2026-11-03")` gives `"3 Nov 2026"`.
  - `formatDateRange(start, end)`.
  - All of these are deterministic, so server and client render the same text.
- **`event-details.ts`:** `validateEventDetails(body, existing)` is used by `POST`/`PUT /api/admin/events`. `parseIsoDate` is also exported.

## API changes in phase 1

### `PUT /api/admin/events`

It now also accepts `name`, `location`, `startDate` and `endDate`, in any status.

- `name` is trimmed, required when present, and at most 200 characters.
- `location` is trimmed. Empty becomes `null`. At most 200 characters.
- Dates are `YYYY-MM-DD`. Empty or `null` clears the date.
- `endDate` must not be before `startDate`. A single changed date is checked against the stored one.
- Errors return 400 with `{ error }`.
- You can send these fields together with `status` or `warehouses`, which keep their existing rules.

`POST` uses the same validation.

### `GET /api/admin/dashboard`

It now returns every event with its real status.

- **All events** gain `endDate` and `lastCountAt`. `lastCountAt` is the latest count time, or `null`.
- **Setup events** have `setup: { itemCount, teamCount, supervisorCount, unassignedCount }`. The counts are scoped to the selected warehouses. Their count statistics are 0.
- **Other events** have `setup: null`.

## Panels (`panels/`)

Shared by the workspace tabs and the setup wizard. Each reads the event from `useAdminEvent()`, calls `reload()` after a change, and takes an optional `onChanged`.

- `ItemsPanel`: upload (XHR with real upload %, then an indeterminate "Processing" bar) or copy from another event; replace and delete-counts confirmations; mapping report; item stats; download imported items; sample CSV (`lib/sample-stock-csv.ts`). Read-only outside setup.
- `WarehousesPanel({ onDirtyChange?, hideWhenEmpty? })`: in-scope warehouses with per-warehouse stats; explicit Save. Read-only outside setup.
- `PeoplePanel`: `TeamsManager` (admin variant) with teams, supervisors and auditors.
- `BinsPanel({ peopleHref? })`: one-click auto-balance across all teams, unassigned counter, then the full manual tools (filters, counted badges, re-assign).
- `ReadinessChecklist({ eventId, state, linkTo })` and `LifecycleActions` / `useLifecycleAction()` (every status change, reset and delete in one place; rules in `lib/event-lifecycle.ts`).
- `LoginSheet`: printable / copyable names, PINs and site address.
- `EventDetailsForm`, `EditEventDetailsDialog`, `saveEventDetails`.
- Data hooks (`use-event-data.ts`): `useJson`, `useReadiness`, `useEventReadiness(event)` (re-fetches when the event context reloads), `useItemsOverview`.

## API changes in phase 2

- `GET /api/admin/import?eventId=X` (new, additive): `{ eventId, status, summary: { totalItems, uniqueBins, uniqueBrands, totalValue }, warehouses: [{ warehouse, itemCount, binCount, totalValue }], selectedWarehouses (null = all), upload: { filename, fileSize, createdAt } | null }`. Without `eventId` it still lists events with items.
- `GET /api/admin/activate?eventId=X` also returns `itemCount`, `teamCount` and `supervisorCount`.
