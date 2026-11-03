// Tutorial copy for the admin area. The setup wizard's guide panels and the Help page both
// read from here, so the wording stays in one place. Plain data: no JSX.

import type { SetupStep } from "@/lib/admin-routes";

export interface GuideReference {
  /** Small heading, e.g. "Columns we read". */
  title: string;
  /** Short lines; rendered as a compact list. */
  items: string[];
}

export interface GuideContent {
  /** Stable id; for wizard steps this is the step slug. */
  id: string;
  title: string;
  /** One or two sentences: what this step is for. */
  summary: string;
  /** What to do, in order. Rendered as a numbered list. */
  steps: string[];
  tips: string[];
  /** Common mistakes and how to avoid them. */
  mistakes: string[];
  /** Optional reference material (accepted columns, roles, ...). */
  reference?: GuideReference[];
  /** Section anchor on /admin/help, e.g. "import-file" -> /admin/help#import-file. */
  helpAnchor: string;
}

export const SETUP_GUIDES: Record<SetupStep, GuideContent> = {
  details: {
    id: "details",
    title: "Name the stocktake",
    summary:
      "Give the count a name everyone will recognise. Teams and supervisors pick it from a list when they log in, so make it obvious which site and period it is for.",
    steps: [
      "Enter a name, for example \"Durban DC year-end 2026\".",
      "Add the site or location so people at different branches can tell events apart.",
      "Add the planned start and end dates if you know them. They are for reference only and can be changed later.",
      "Continue to create the stocktake. It starts in setup, so nobody can count until you go live.",
    ],
    tips: [
      "You can edit the name, location and dates at any time, even after the count has started.",
      "You can leave the wizard whenever you like. Your progress is saved and \"Continue setup\" on the Overview page brings you back to the right step.",
    ],
    mistakes: [
      "Reusing last year's name unchanged. When two events have the same name people log in to the wrong one.",
      "Setting an end date before the start date. The form will not accept it.",
    ],
    helpAnchor: "event-details",
  },

  items: {
    id: "items",
    title: "Upload the stock file",
    summary:
      "Import the expected stock from NetSuite: one row per item per bin, with the quantity on hand. This is what teams will count against.",
    steps: [
      "In NetSuite, run your inventory-by-bin saved search and export it as CSV (or Excel).",
      "Make sure the file has at least an item code column. Add warehouse, bin, quantity on hand and average cost so variances can be valued.",
      "Upload the file here, or copy the items from a previous stocktake if the stock has not changed.",
      "Check the import report: recognised columns are listed, and any column we ignored is shown so you can spot a misnamed header.",
      "Check the totals (items, bins, warehouses and stock value) look right before you continue.",
    ],
    tips: [
      "CSV files must be comma-separated. Wrap values that contain commas in double quotes, for example \"Bolt, M8\".",
      "Numbers with thousands separators such as \"1,234\" or \"R 1 234.50\" are read correctly.",
      "Item codes with leading zeros (\"0500\") keep their zeros in CSV files.",
      "Rows with a blank warehouse are grouped under \"(No warehouse)\" and rows with a blank bin under \"(No bin)\", so nothing is lost.",
      "If total value is missing it is worked out as on hand x average cost.",
      "You can replace the file as often as you like while the stocktake is in setup.",
    ],
    mistakes: [
      "Using a semicolon- or tab-separated CSV. Save it as \"CSV (Comma delimited)\".",
      "Exporting a summary search without bins. Teams count by bin, so every row should carry its bin.",
      "Files over 50 MB are rejected. Remove unused columns or split the export.",
      "Replacing the file after people have started counting deletes the counts. Only replace during setup.",
      "Rows without an item code are skipped. Check the row count in the report if it looks short.",
    ],
    reference: [
      {
        title: "Accepted files",
        items: [
          "CSV (comma-separated, quoted fields allowed), .xlsx or .xls. For Excel, only the first sheet is read.",
          "Maximum size 50 MB.",
          "The first row must be the column headers.",
        ],
      },
      {
        title: "Columns we read (any of these header names)",
        items: [
          "Item code (required): Item, Item Code, SKU, Part Number, Product Code",
          "Description: Description, Item Description, Name",
          "Warehouse: Warehouse, Warehouse Name",
          "Bin: Bin, Bin Number, Bin Location, Location",
          "On hand: On Hand, Qty, Quantity, Quantity On Hand, SOH",
          "Average cost: Avg Cost, Average Cost, Unit Cost, Cost",
          "Total value: Total Value, Value, Extended Cost, Amount",
          "Serial / lot: Serial Number, Serial/Lot Number, Lot Number",
          "Also read when present: Internal ID, Bin Internal ID, Brand, Category, Division, Status",
        ],
      },
    ],
    helpAnchor: "import-file",
  },

  warehouses: {
    id: "warehouses",
    title: "Choose warehouses",
    summary:
      "Your file may cover several warehouses. Pick the ones being counted in this stocktake; items in other warehouses are left out of counting, assignments and results.",
    steps: [
      "Tick each warehouse that is being counted.",
      "Check the item count and value next to each one to confirm you have the right selection.",
      "Save your selection and continue.",
    ],
    tips: [
      "This step is skipped automatically when the file contains only one warehouse.",
      "\"(No warehouse)\" holds rows that had a blank warehouse in the file. Include it if those items should be counted.",
      "You can change the selection until you go live. Re-importing the file keeps your selection where those warehouses still exist.",
    ],
    mistakes: [
      "Leaving out a warehouse and only noticing on count day. The selection is locked once the stocktake is live.",
      "Deselecting everything. At least one warehouse must be selected.",
    ],
    helpAnchor: "warehouses",
  },

  people: {
    id: "people",
    title: "Add teams and supervisors",
    summary:
      "Create the counting teams and the supervisors who review their work. Everyone logs in on their phone or tablet by picking this stocktake, picking their name and entering a PIN.",
    steps: [
      "Add your counting teams. For more than a handful, use bulk create or import them from an Excel sheet (Team Name, PIN, Members).",
      "Give each team a PIN of 4 to 6 digits and, optionally, list the members' names.",
      "Add at least one supervisor with their own PIN. You cannot go live without one.",
      "Add auditors if someone independent needs to check counts. This is optional.",
      "Note the PINs down or print the login sheet on the final step so you can hand them out.",
    ],
    tips: [
      "Teams count the bins assigned to them and raise queries. Supervisors review variances, order recounts and approve breakdowns. Auditors carry out the verification counts supervisors order.",
      "Teams can log in during setup to check their PIN works, but counting only opens once you go live.",
      "In the Excel import, format the PIN column as text so PINs that start with 0 keep their zero.",
      "You can add or edit teams and PINs later, including while the count is live.",
    ],
    mistakes: [
      "PINs shorter than 4 or longer than 6 digits, or containing letters. They are rejected.",
      "Forgetting the supervisor. Go live stays blocked until at least one exists.",
      "Sharing one team PIN between several groups. Each group of counters should be its own team so results can be traced.",
    ],
    reference: [
      {
        title: "Roles",
        items: [
          "Team: counts its assigned bins on a phone or tablet.",
          "Supervisor: monitors progress, reviews variances, answers queries.",
          "Auditor: performs verification counts ordered by a supervisor.",
          "Admin (you): sets up the stocktake, controls its status and exports results.",
        ],
      },
    ],
    helpAnchor: "people-and-roles",
  },

  bins: {
    id: "bins",
    title: "Assign bins to teams",
    summary:
      "Every bin in the selected warehouses must belong to a team before you can go live. A team only sees and counts the bins assigned to it.",
    steps: [
      "Click \"Auto-balance across all teams\" to share all unassigned bins evenly. This is the quickest option for most stocktakes.",
      "Choose whether to balance by number of bins or by number of items if bins vary a lot in size.",
      "Adjust by hand where needed: select bins and assign them to a team, or move bins between teams.",
      "Continue when the unassigned count reaches zero.",
    ],
    tips: [
      "Keep each aisle or area with one team where possible; it saves walking.",
      "Bins called \"(No bin)\" hold items that had no bin in the file. Give them to a team that knows where those items are.",
      "You can still reassign bins after going live, for example when a team finishes early.",
    ],
    mistakes: [
      "Adding a team after auto-balancing. The new team has no bins until you balance again or assign some by hand.",
      "Changing the warehouse selection after assigning. Newly included items arrive unassigned, so check the count again.",
    ],
    helpAnchor: "assigning-bins",
  },

  review: {
    id: "review",
    title: "Review and go live",
    summary:
      "A final check before counting starts. Going live opens the count for every team at once.",
    steps: [
      "Work through the checklist. Each item links back to the step that fixes it.",
      "Print or copy the login sheet (site address, team names and PINs) and hand it out.",
      "Click \"Go live\" when the teams are ready to start.",
    ],
    tips: [
      "When you go live: teams can start counting, supervisors see progress and variances in real time, and the stock file and warehouse selection are locked.",
      "If something is wrong after going live you can move the stocktake back to setup. Counts already captured are kept.",
      "When counting is done, mark the stocktake complete, review the results, export to NetSuite and then lock it.",
    ],
    mistakes: [
      "Going live before the login sheet is handed out, leaving teams waiting at the door.",
      "Going live with the wrong stock file. Replacing it later means going back to setup and deleting the counts.",
    ],
    reference: [
      {
        title: "Go live needs",
        items: [
          "Items imported in the selected warehouses",
          "At least one team",
          "At least one supervisor",
          "Every in-scope item assigned to a team",
        ],
      },
    ],
    helpAnchor: "going-live",
  },
};

/** Guide for a wizard step. */
export function setupGuide(step: SetupStep): GuideContent {
  return SETUP_GUIDES[step];
}

/** Help page sections (anchor + title), in reading order. Wizard guides link to these anchors. */
export const HELP_SECTIONS: { anchor: string; title: string }[] = [
  { anchor: "lifecycle", title: "How a stocktake runs" },
  { anchor: "event-details", title: "Creating a stocktake" },
  { anchor: "import-file", title: "The stock file" },
  { anchor: "warehouses", title: "Choosing warehouses" },
  { anchor: "people-and-roles", title: "People and roles" },
  { anchor: "assigning-bins", title: "Assigning bins" },
  { anchor: "going-live", title: "Going live" },
  { anchor: "count-day", title: "Running the count" },
  { anchor: "reviewing", title: "Reviewing variances" },
  { anchor: "closing-exporting", title: "Closing and exporting to NetSuite" },
  { anchor: "faq", title: "FAQ and troubleshooting" },
];
