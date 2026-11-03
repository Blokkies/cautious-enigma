// A small example stock file, generated in the browser for the "Download sample" link.
// Headers are ones the importer (src/lib/excel.ts COLUMN_MAP) recognises, so the sample
// imports cleanly and shows the expected layout. Pure, no xlsx dependency.

export const SAMPLE_STOCK_HEADERS = [
  "Internal ID",
  "Item",
  "Description",
  "Brand",
  "Category",
  "Warehouse",
  "Bin Number",
  "Bin Internal ID",
  "On Hand",
  "Avg Cost",
  "Total Value",
  "Serial/Lot Number",
] as const;

const SAMPLE_ROWS: (string | number)[][] = [
  ["10234", "0500-BLT", "Bolt, M8 x 40 zinc", "Fastco", "Fasteners", "Durban DC", "A-01-01", "551", 1250, 1.85, 2312.5, ""],
  ["10235", "0501-NUT", "Nut, M8 zinc", "Fastco", "Fasteners", "Durban DC", "A-01-01", "551", "1,400", 0.6, 840, ""],
  ["20410", "DRL-18V", "Cordless drill 18V", "Volta", "Power tools", "Durban DC", "B-02-03", "612", 2, 1899, 3798, "VT18-000123"],
  ["20410", "DRL-18V", "Cordless drill 18V", "Volta", "Power tools", "Durban DC", "B-02-03", "612", 1, 1899, 1899, "VT18-000124"],
  ["30001", "GLV-L", "Work gloves, large", "SafeHand", "PPE", "Cape Town", "C-10", "701", 48, 35.5, "", ""],
  ["30002", "GLV-M", "Work gloves, medium", "SafeHand", "PPE", "Cape Town", "", "", 12, 35.5, 426, ""],
];

/** Quote a CSV cell when it contains a comma, quote or line break. */
export function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The sample stock file as comma-separated text (CRLF line endings, like Excel saves). */
export function sampleStockCsv(): string {
  return [SAMPLE_STOCK_HEADERS as readonly (string | number)[], ...SAMPLE_ROWS]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
