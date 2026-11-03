// Long-form copy for /admin/help. The short step guides (shared with the setup wizard) live in
// guide-content.ts; this module adds the material that only the Help page shows.
// Every statement here is checked against the code; keep it that way when behaviour changes.

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminRoutes } from "@/lib/admin-routes";
import { StatusBadge } from "./status-badge";

// ---------------------------------------------------------------------------------------------
// Small typographic pieces

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900 first:mt-0">{children}</h3>;
}

export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm leading-relaxed text-slate-600 [&+p]:mt-2", className)}>{children}</p>;
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed text-slate-600">
      {items.map((item, i) => (
        <li key={i} className="relative pl-3.5 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-slate-300">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
          >
            {i + 1}
          </span>
          <span className="text-slate-700">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({ tone = "info", children }: { tone?: "info" | "warning"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "mt-4 flex gap-2.5 rounded-md border p-3 text-sm",
        tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warning" ? "text-amber-600" : "text-primary")} aria-hidden="true" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Two- or three-column reference table that stacks into cards on small screens. */
function RefTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="hidden bg-slate-50 text-xs text-slate-500 sm:table-header-group">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className="block px-3 py-2.5 sm:table-row sm:p-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "block align-top text-slate-600 sm:table-cell sm:px-3 sm:py-2.5",
                    j === 0 && "font-medium text-slate-900 sm:w-44",
                    j > 0 && "mt-1 sm:mt-0"
                  )}
                >
                  {j > 0 && <span className="text-xs text-slate-400 sm:hidden">{head[j]}: </span>}
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-800">{children}</code>;
}

/** An exact on-screen message, so people can match what they see. */
function Msg({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-slate-800">&ldquo;{children}&rdquo;</span>;
}

function HelpLink({ anchor, children }: { anchor: string; children: React.ReactNode }) {
  return (
    <a href={`#${anchor}`} className="font-medium text-primary hover:underline">
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------------------------
// Lifecycle

export const PHASES: { title: string; body: string }[] = [
  { title: "Set up", body: "Create the stocktake, upload the NetSuite stock file, choose warehouses, add teams and supervisors, and assign every bin." },
  { title: "Go live", body: "Hand out the login sheet and open counting for every team at once." },
  { title: "Count", body: "Teams count their bins on phones or tablets, even without signal. Supervisors watch progress live." },
  { title: "Review", body: "Supervisors accept variances, send doubtful ones for a recount and resolve serial number differences." },
  { title: "Close & export", body: "Mark the stocktake complete, download the NetSuite adjustment files, then lock it." },
];

export function LifecycleExtra() {
  return (
    <>
      <H3>The five phases</H3>
      <ol className="grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-5">
        {PHASES.map((p, i) => (
          <li key={p.title} className="bg-white p-3">
            <div className="text-xs font-semibold tabular-nums text-primary">{i + 1}</div>
            <div className="text-sm font-semibold text-slate-900">{p.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{p.body}</p>
          </li>
        ))}
      </ol>

      <H3>Moving between statuses</H3>
      <P>You change the status from the event&apos;s Overview tab. These are the only moves allowed:</P>
      <div className="mt-3">
        <RefTable
          head={["Move", "What happens"]}
          rows={[
            [<>Go live</>, <>In setup to Live. Only possible once the go-live checklist is complete (see <HelpLink anchor="going-live">Going live</HelpLink>). Counting opens and the stock file and warehouse choice are locked.</>],
            [<>Back to setup</>, <>Live to In setup. Counting pauses so you can fix the setup. Counts already captured are kept.</>],
            [<>Mark complete</>, <>Live to Completed. Counting stops for good, teams can no longer log in, and supervisor screens become read-only. Results and exports are ready.</>],
            [<>Lock</>, <>Completed to Locked. The stocktake is archived. Supervisors and auditors can no longer log in; you can still see results and download exports.</>],
            [<>Reopen</>, <>Locked to Live. Counting opens again. A completed stocktake can&apos;t go straight back to live: lock it first, then reopen.</>],
          ]}
        />
      </div>

      <H3>Who can log in when</H3>
      <RefTable
        head={["Status", "Teams", "Supervisors and auditors"]}
        rows={[
          [<StatusBadge key="s" status="setup" showDescription={false} />, "Can log in to check their PIN, but cannot count yet", "Can log in"],
          [<StatusBadge key="a" status="active" showDescription={false} />, "Log in and count", "Log in and review"],
          [<StatusBadge key="c" status="completed" showDescription={false} />, "Cannot log in", "Can log in, read-only"],
          [<StatusBadge key="l" status="locked" showDescription={false} />, "Cannot log in", "Cannot log in"],
        ]}
      />
      <P className="mt-2 text-xs text-slate-500">Admins and executives can always log in; they use a password, not a PIN.</P>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Stock file

const COLUMN_ROWS: [string, string][] = [
  ["Item code (required)", "Item, Item Code, SKU, Part Number, Product Code"],
  ["Description", "Description, Item Description, Desc, Name, Item Name"],
  ["Warehouse", "Warehouse, Warehouse Name, WH"],
  ["Bin", "Bin, Bin Number, Bin Location, Location"],
  ["On hand", "On Hand, Qty, Quantity, Qty On Hand, Quantity On Hand, Stock On Hand, SOH"],
  ["Average cost", "Avg Cost, Average Cost, Unit Cost, Cost"],
  ["Total value", "Total Value, Value, Extended Cost, Ext Cost, Amount"],
  ["Serial / lot number", "Serial Number, Serial #, Serial, Serial/Lot Number, Serial/Lot, Lot Number, Lot #, Lot, Number"],
  ["Item internal ID", "Item Internal ID, Internal ID, InternalID, NetSuite ID"],
  ["Bin internal ID", "Bin Internal ID, Bin Location Internal ID, Bin Number Internal ID, Location Internal ID"],
  ["Brand", "Brand, Manufacturer, Vendor"],
  ["Category", "Category, Stock Category, Item Category, Type, Item Type"],
  ["Division", "Division, Dept, Department"],
  ["Stock status", "Status, Stock Status, Item Status, Inventory Status, Availability"],
];

export function ImportFileExtra() {
  return (
    <>
      <H3>Preparing the file in NetSuite</H3>
      <Steps
        items={[
          "Run an inventory search that lists stock by bin: one row for every item in every bin, with the quantity on hand. For serialized items, one row per serial number.",
          "Include the item and bin internal IDs. They are carried through to the NetSuite adjustment files, which makes the import back into NetSuite straightforward.",
          "Include average cost so variances can be valued in rand. Total value is optional; it is worked out as on hand × average cost when missing.",
          "Export as CSV or Excel. Keep the header row as the first row and don't add totals or blank rows above it.",
        ]}
      />

      <H3>Columns we recognise</H3>
      <P>
        Headers are matched without caring about capitals, spaces or punctuation, so <Code>Qty On Hand</Code>, <Code>qty_on_hand</Code>{" "}
        and <Code>QTY-ON-HAND</Code> all work. Any other column is ignored and listed in the import report so you can spot a
        misspelt header.
      </P>
      <div className="mt-3">
        <RefTable head={["Field", "Header names accepted"]} rows={COLUMN_ROWS.map(([f, h]) => [f, h])} />
      </div>

      <H3>How values are read</H3>
      <Bullets
        items={[
          <>Numbers may include an <Code>R</Code> or <Code>ZAR</Code> prefix and thousands separators, for example <Code>R 1 234.50</Code> or <Code>1,234</Code>.</>,
          <>A serial of <Code>- None -</Code> (NetSuite&apos;s placeholder) counts as blank. Any row with a serial number is treated as a serialized item: teams scan each serial instead of typing a quantity.</>,
          <>A blank warehouse becomes <Code>(No warehouse)</Code> and a blank bin becomes <Code>(No bin)</Code>, so no rows are lost.</>,
          "Rows without an item code are skipped. If no row has one, the import stops and lists the headers it found.",
          "In CSV files every value is kept as text, so item codes with leading zeros keep them.",
        ]}
      />

      <H3>Replacing the file</H3>
      <P>
        You can upload a new file, or copy items from another stocktake, as often as you like while the stocktake is in setup.
        Each import replaces all items. If counts already exist (for example after going back to setup), you are told how many
        will be deleted and must confirm first. Bin assignments are cleared, so assign bins again afterwards. Your warehouse
        choice is kept where those warehouses still exist.
      </P>
      <P>The original of every uploaded file is kept on the <Link href={adminRoutes.files} className="font-medium text-primary hover:underline">Files</Link> page.</P>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// People, roles, PINs and the login sheet

export function PeopleExtra() {
  return (
    <>
      <H3>What each role can do</H3>
      <RefTable
        head={["Role", "Logs in with", "Can do"]}
        rows={[
          ["Admin", "Password", "Everything in this admin area: create and set up stocktakes, change their status, manage accounts and export. Can also open the executive dashboard."],
          ["Supervisor", "Name and PIN, per stocktake", "Follows progress, accepts or edits variances, sends items for a recount, resolves serial discrepancies, answers queries, approves breakdowns, adds and edits teams, reassigns bins, messages executives and downloads exports. Cannot add supervisors or auditors. Read-only once the stocktake is completed."],
          ["Auditor", "Name and PIN, per stocktake", "Sees every supervisor screen read-only and can download exports and message executives. Cannot change anything."],
          ["Team", "Team name and PIN, per stocktake", "Counts the bins assigned to it, scans serial numbers, raises queries, reports breakdowns and does the recounts supervisors send it."],
          ["Executive", "Password", "Read-only executive dashboard across live, completed and locked stocktakes, read-only variances, exports, and messages with supervisors."],
        ]}
      />
      <P className="mt-2 text-xs text-slate-500">
        Admin and executive accounts are managed on the <Link href={adminRoutes.accounts} className="font-medium text-primary hover:underline">Accounts</Link> page. Teams, supervisors and auditors belong to one stocktake and are managed on its People tab.
      </P>

      <H3>PINs</H3>
      <Bullets
        items={[
          "A PIN is 4 to 6 digits. Letters and symbols are not allowed.",
          "Each team, supervisor and auditor has its own PIN. PINs don't have to be unique, but giving everyone a different one avoids mix-ups.",
          "You can see and change PINs on the People tab at any time, including during the count.",
          "After 10 login attempts from the same network within a minute, further attempts are refused until the minute is up.",
        ]}
      />

      <H3>Adding many teams from Excel</H3>
      <P>
        Download the template from the People tab, fill one row per team and import it. Columns: <Code>Team Name</Code> and{" "}
        <Code>PIN</Code> (required), and <Code>Members</Code> (optional, names separated by commas). Keep the PIN column formatted
        as text so PINs starting with 0 keep their zero. Teams whose name already exists in the stocktake are skipped. The file
        may be up to 5 MB.
      </P>

      <H3>The login sheet</H3>
      <P>
        The last setup step has a printable login sheet with the site address, the stocktake name, and every team (with members),
        supervisor and auditor with their PIN. Print it or copy it into a message before count day. It tells people to open the
        site on a phone or tablet, choose their role, choose the stocktake, pick their name and enter their PIN.
      </P>
      <P>Once logged in, people stay logged in on that device for up to 72 hours of use.</P>
    </>
  );
}

export function BinsExtra() {
  return (
    <Callout>
      <P>
        Supervisors can also reassign bins during the count from their Assign screen, for example to move work from a slow team
        to one that has finished. A bin that has already been counted shows a counted badge.
      </P>
    </Callout>
  );
}

export function GoingLiveExtra() {
  return (
    <>
      <H3>If Go live is blocked</H3>
      <P>The checks run in this order and the first one that fails is shown:</P>
      <div className="mt-3">
        <RefTable
          head={["Message", "Fix"]}
          rows={[
            [<Msg key="1">The event has no items in its selected warehouses</Msg>, "Upload the stock file, or include a warehouse that has items."],
            [<Msg key="2">The event has no counting teams</Msg>, "Add at least one team on the People step."],
            [<Msg key="3">The event has no supervisors</Msg>, "Add at least one supervisor on the People step."],
            [<Msg key="4">N items are not assigned to a team</Msg>, "Open the Bins step and auto-balance, or assign the remaining bins by hand."],
          ]}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Count day

export function CountDay() {
  return (
    <>
      <P>Once the stocktake is live, teams count and supervisors review at the same time. As an admin you mostly watch and step in when needed.</P>

      <H3>How a team counts</H3>
      <Steps
        items={[
          "Open the site on a phone or tablet, choose Team, choose the stocktake, pick the team name and enter the PIN.",
          "The bin list shows the team's bins as Not started, In progress and Completed, plus a Verification tab for recounts a supervisor has sent. Search finds a bin quickly.",
          "In a bin, the team works through the items one by one and types the quantity found. The expected quantity and the difference are shown as they go, and a note can be added to any item.",
          "For serialized items the team scans each serial with a barcode scanner (or types it). The app says whether it matched, was already scanned, belongs in another bin, or is unknown. Unknown serials are sent to supervisors as a serial discrepancy.",
          "At the end of a bin the team can review the list and recount any item before moving on.",
        ]}
      />

      <H3>Without signal</H3>
      <P>
        The counting app keeps working offline. Counts are saved on the device first, the team sees{" "}
        <Msg>Saved offline — will sync when back online</Msg>, and everything is sent automatically when the connection returns.
        If the server refuses a saved count (for example because a supervisor already accepted that item), the team sees a banner
        listing what was rejected.
      </P>

      <H3>Queries and breakdowns</H3>
      <Bullets
        items={[
          "A query is a question to the supervisors: missing item, damaged stock, wrong location, quantity question or other. Each one is a chat thread.",
          "A breakdown records stock that moved or was broken down during the count (client, item, quantity, PO number and reason). Supervisors approve or reject it. Breakdowns do not change counts; they are logged and exported for follow-up.",
        ]}
      />

      <H3>What supervisors see</H3>
      <P>
        Supervisors have a dashboard with live progress, a per-bin progress view, the variances list, team comments, queries,
        breakdowns, messages from executives, exports and a summary. They can add or edit teams and reassign bins while the
        count runs.
      </P>

      <H3>What you can do as admin</H3>
      <Bullets
        items={[
          <>Follow every live stocktake on the <Link href={adminRoutes.overview} className="font-medium text-primary hover:underline">Overview</Link>, which refreshes every 15 seconds and flags open queries, breakdowns to approve and serial discrepancies.</>,
          "Add a team or change a PIN on the People tab, and move bins between teams on the Bins tab.",
          "Move the stocktake back to setup if something fundamental is wrong. Counts are kept, but nobody can count until it is live again.",
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Reviewing

export function Reviewing() {
  return (
    <>
      <P>
        Every count starts as <span className="font-medium text-slate-800">pending</span>. A supervisor reviews it and either
        accepts it, corrects it or sends the item for a recount. <span className="font-medium text-slate-800">Accepted</span>{" "}
        counts are final: the team can no longer change them, and only accepted counts go into the NetSuite files.
      </P>

      <H3>The variances list</H3>
      <Bullets
        items={[
          "Active holds counts that still need a decision, Accepted holds the ones that are done, and Resolved holds serial discrepancies that are closed.",
          "Supervisors can accept one variance or many at once, or edit the counted quantity with a reason (which also accepts it). Serialized items can only be 0 or 1.",
          "An accepted variance can be reopened if it needs another look.",
        ]}
      />

      <H3>Recounts</H3>
      <Steps
        items={[
          "The supervisor selects the doubtful variances and chooses Distribute Verification Counts, picking the teams to do them. The app avoids giving an item back to the team that first counted it.",
          "Those teams see the items on their Verification tab and count them again.",
          "The supervisor then keeps the original count or accepts the recounted quantity. Either way the item becomes accepted.",
        ]}
      />
      <P className="mt-2">An item can only have one recount open at a time, and it can&apos;t be accepted while its recount is still pending.</P>

      <H3>Serial discrepancies</H3>
      <P>
        When a team scans a serial that wasn&apos;t expected in that bin, or expected serials are not found, a serial discrepancy is
        opened. For each one a supervisor can approve, dismiss or correct the unknown serials, mark expected serials as found or not
        found, send it to a team for a serial verification, and finally resolve it. Resolving is blocked while a verification is
        still in progress. Only approved serials of resolved discrepancies are exported to NetSuite.
      </P>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Closing and exporting

export function ClosingExporting() {
  return (
    <>
      <Steps
        items={[
          "When the teams are done, open the stocktake and choose Mark complete. Counting stops, teams can no longer log in and supervisors switch to read-only.",
          "Check the Results tab: overall progress, results per team and the largest variances.",
          "Make sure every variance is accepted and every serial discrepancy resolved. If the review is not finished, you can't reopen a completed stocktake directly: lock it, then reopen it to go live again.",
          "Download the NetSuite files and post the adjustments in NetSuite.",
          "Lock the stocktake. It is archived, nothing can change, and results and exports stay available here.",
        ]}
      />

      <H3>The NetSuite files</H3>
      <P>
        Four files hold the adjustments. &ldquo;Up&rdquo; means more was counted than NetSuite expected; &ldquo;down&rdquo; means less.
      </P>
      <div className="mt-3">
        <RefTable
          head={["File", "Contains"]}
          rows={[
            ["Non-serialized up", "Ordinary items counted above the on-hand quantity."],
            ["Non-serialized down", "Ordinary items counted below the on-hand quantity."],
            ["Serialized up", "Serials found that were not expected: accepted serialized over-counts plus approved serials of resolved discrepancies, each serial once."],
            ["Serialized down", "Expected serials that were not found."],
          ]}
        />
      </div>
      <P className="mt-3">
        Each row includes the item and bin internal IDs, item code, description, warehouse, bin, serial number, on hand, average
        cost, counted quantity, variance, variance value, team and comment. Rows are sorted largest value first.
      </P>
      <Callout tone="warning">
        <p>
          Only <strong className="font-semibold">accepted</strong> counts and approved serials of <strong className="font-semibold">resolved</strong> discrepancies are
          included. Before you download, the Exports page tells you how many unreviewed variances would be left out.
        </p>
      </Callout>

      <H3>Where to download</H3>
      <Bullets
        items={[
          <>The <Link href={adminRoutes.exports} className="font-medium text-primary hover:underline">Exports</Link> page builds one ZIP of the four NetSuite files for several stocktakes at once, one folder per stocktake. If any file fails to download, no ZIP is produced, so NetSuite never gets a partial set.</>,
          "Each stocktake's Exports tab has every report: the master export (every item with its count), all variances, serial numbers, queries, breakdowns, recounts and the audit log, in Excel or CSV, plus a ZIP of all of them.",
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// FAQ

export const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Go live is greyed out or says \"Cannot activate\"",
    a: (
      <P>
        The checklist isn&apos;t complete. The message names the first thing missing: items in the selected warehouses, a team, a
        supervisor, or bins still unassigned. See <HelpLink anchor="going-live">Going live</HelpLink> for each fix.
      </P>
    ),
  },
  {
    q: "A team can't log in",
    a: (
      <Bullets
        items={[
          <>They see <Msg>Invalid credentials</Msg>: the PIN doesn&apos;t match the name they picked. Check both on the People tab, where you can view or reset the PIN.</>,
          "Their team isn't in the list: they chose the wrong stocktake, or the team hasn't been added yet.",
          <>They see <Msg>This stocktake is completed. Teams can no longer log in to it.</Msg>: teams can only log in while the stocktake is in setup or live.</>,
          <>They see <Msg>Too many login attempts. Please try again later.</Msg>: wait one minute and try again.</>,
        ]}
      />
    ),
  },
  {
    q: "A team is logged in but can't save counts",
    a: (
      <P>
        If they see <Msg>This stocktake has not been activated yet.</Msg>, the stocktake is still in setup. Go live first. Counts
        they saved offline are kept on the device and sent once counting is open.
      </P>
    ),
  },
  {
    q: "A team can't change a count",
    a: (
      <P>
        Once a supervisor accepts an item, it is final for the team. While a recount is pending the item is also locked. A
        supervisor can reopen an accepted variance or edit the quantity with a reason.
      </P>
    ),
  },
  {
    q: "The import failed or says the file is too large",
    a: (
      <Bullets
        items={[
          <><Msg>File too large. Maximum size is 50MB.</Msg>: remove columns you don&apos;t need or split the export by warehouse into separate stocktakes.</>,
          <><Msg>No valid items found in file</Msg>: no column was recognised as the item code, or every row is blank there. Check the header names against the list in <HelpLink anchor="import-file">The stock file</HelpLink>.</>,
          "Everything ends up in one column: the CSV uses semicolons or tabs. Save it again as CSV (Comma delimited).",
          "Rows seem to be missing: only the first sheet of an Excel file is read, and rows without an item code are skipped.",
          <><Msg>Can only import data during setup phase</Msg>: move the stocktake back to setup first. Re-importing deletes the counts already captured.</>,
        ]}
      />
    ),
  },
  {
    q: "Some items are unassigned",
    a: (
      <P>
        New items arrive unassigned when you import or replace the file, include another warehouse, or add a team after
        auto-balancing (the new team simply has no bins). Open the Bins step and run auto-balance again or assign the remaining bins
        by hand. Go live stays blocked until the unassigned count is zero.
      </P>
    ),
  },
  {
    q: "Variances are missing from the NetSuite files",
    a: (
      <P>
        The files only carry accepted counts and approved serials of resolved serial discrepancies. Ask a supervisor to finish
        the review, then download again. The Exports page shows how many were left out per stocktake.
      </P>
    ),
  },
  {
    q: "We found a mistake in the stock file after going live",
    a: (
      <P>
        Move the stocktake back to setup and import the corrected file. Importing replaces all items and deletes every count
        captured so far; you are told how many and asked to confirm. Then assign bins and go live again.
      </P>
    ),
  },
  {
    q: "We need to count again after marking complete",
    a: <P>A completed stocktake can&apos;t go straight back to live. Lock it, then use Reopen, which makes it live again.</P>,
  },
  {
    q: "A supervisor can't add another supervisor or an auditor",
    a: <P>Only admins can add supervisors and auditors. Do it on the stocktake&apos;s People tab.</P>,
  },
  {
    q: "Someone forgot their admin or executive password",
    a: (
      <P>
        Passwords can&apos;t be viewed or reset. Another admin creates a new account for them on the{" "}
        <Link href={adminRoutes.accounts} className="font-medium text-primary hover:underline">Accounts</Link> page and deletes the old one.
      </P>
    ),
  },
  {
    q: "A stocktake can't be deleted",
    a: <P>Completed and locked stocktakes that have counts are kept for the record and can&apos;t be deleted. Lock them instead.</P>,
  },
];

export function Faq() {
  return (
    <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {FAQ.map((item) => (
        <details key={item.q} className="group px-3 py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded py-2 text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden="true" className="text-lg leading-none text-slate-400 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="pb-3">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
