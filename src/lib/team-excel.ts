import * as XLSX from "xlsx";
import { isCsvSource, type SpreadsheetSource } from "./excel";

export interface ParsedTeam {
  name: string;
  pin: string;
  members: string[];
}

export interface TeamParseResult {
  validTeams: ParsedTeam[];
  errors: { row: number; message: string }[];
  totalRows: number;
}

/**
 * Generate a template Excel file for team import.
 * PIN column is formatted as text to preserve leading zeros.
 */
export function generateTeamTemplate(): Uint8Array {
  const data = [
    { "Team Name": "Warehouse A", PIN: "1001", Members: "Alice, Bob" },
    { "Team Name": "Warehouse B", PIN: "1002", Members: "Charlie, Diana" },
    { "Team Name": "Office Team", PIN: "0500", Members: "Eve" },
  ];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Set column widths
  worksheet["!cols"] = [
    { wch: 20 }, // Team Name
    { wch: 10 }, // PIN
    { wch: 40 }, // Members
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, "Teams");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

// Flexible column name mapping (lowercase-normalized)
const COLUMN_MAP: Record<string, keyof ParsedTeam> = {
  "team name": "name",
  "team_name": "name",
  "teamname": "name",
  "team": "name",
  "name": "name",

  "pin": "pin",
  "pin code": "pin",
  "pin_code": "pin",
  "pincode": "pin",
  "password": "pin",
  "code": "pin",

  "members": "members",
  "member": "members",
  "team members": "members",
  "team_members": "members",
  "people": "members",
};

function normalizeColumnName(col: string): string {
  return col
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, "")
    .trim();
}

/**
 * Text for a PIN cell: prefer the formatted text (keeps leading zeros of text or "0000"-formatted
 * cells); fall back to the raw number when the formatted text isn't plain digits.
 */
function pinText(formatted: string, raw: unknown): string {
  if (/^\d+$/.test(formatted)) return formatted;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return String(raw);
  return formatted;
}

/**
 * Parse an uploaded Excel file into team data.
 * Validates names, PINs, and checks for duplicates.
 */
export function parseTeamExcel(buffer: ArrayBuffer, source?: SpreadsheetSource): TeamParseResult {
  // raw: true keeps CSV cells as text (PIN "0500" stays "0500"); CSVs are always comma-separated.
  const workbook = XLSX.read(buffer, { type: "array", raw: true, ...(isCsvSource(source) ? { FS: "," } : {}) });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // defval keeps every header column even when the first data row leaves it blank.
  // Formatted text (raw: false) keeps PINs typed as text or formatted "0000" intact;
  // the raw values are used as a fallback when the formatted text isn't plain digits
  // (e.g. "1.23E+11" for a long numeric PIN in a General-format cell).
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: "" });
  const rawValues = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: "" });

  const errors: { row: number; message: string }[] = [];
  const validTeams: ParsedTeam[] = [];
  const seenNames = new Set<string>();

  if (rawData.length === 0) {
    return { validTeams: [], errors: [{ row: 0, message: "File is empty or has no data rows" }], totalRows: 0 };
  }

  // Map headers to fields
  const headers = Object.keys(rawData[0]);
  const headerMapping: Record<string, keyof ParsedTeam> = {};

  for (const header of headers) {
    const normalized = normalizeColumnName(header);
    const mapped = COLUMN_MAP[normalized];
    if (mapped) {
      headerMapping[header] = mapped;
    }
  }

  if (!Object.values(headerMapping).includes("name")) {
    errors.push({ row: 0, message: "Missing required column: Team Name" });
    return { validTeams: [], errors, totalRows: rawData.length };
  }
  if (!Object.values(headerMapping).includes("pin")) {
    errors.push({ row: 0, message: "Missing required column: PIN" });
    return { validTeams: [], errors, totalRows: rawData.length };
  }

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const rowNum = i + 2; // Excel row (1-indexed header + 1-indexed data)

    let name = "";
    let pin = "";
    let membersRaw = "";

    for (const [header, field] of Object.entries(headerMapping)) {
      const val = row[header];
      if (val === undefined || val === null) continue;
      const strVal = String(val).trim();

      if (field === "name") name = strVal;
      else if (field === "pin") pin = pinText(strVal, rawValues[i]?.[header]);
      else if (field === "members") membersRaw = strVal;
    }

    // Skip completely empty rows
    if (!name && !pin && !membersRaw) continue;

    // Validate name
    if (!name) {
      errors.push({ row: rowNum, message: "Team name is empty" });
      continue;
    }

    // Check duplicate names (case-insensitive)
    const nameLower = name.toLowerCase();
    if (seenNames.has(nameLower)) {
      errors.push({ row: rowNum, message: `Duplicate team name: "${name}"` });
      continue;
    }

    // Validate PIN
    if (!pin) {
      errors.push({ row: rowNum, message: `Team "${name}": PIN is empty` });
      continue;
    }
    // Strip non-digit characters
    const pinDigits = pin.replace(/\D/g, "");
    if (pinDigits.length < 4) {
      errors.push({ row: rowNum, message: `Team "${name}": PIN must be at least 4 digits (got "${pin}")` });
      continue;
    }

    // Parse members (comma-separated)
    const members = membersRaw
      ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean)
      : [];

    seenNames.add(nameLower);
    validTeams.push({ name, pin: pinDigits, members });
  }

  return { validTeams, errors, totalRows: rawData.length };
}
