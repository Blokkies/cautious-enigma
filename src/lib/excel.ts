import * as XLSX from "xlsx";

export interface ImportedItem {
  internalId: string;
  itemCode: string;
  description: string;
  brand: string;
  category: string;
  binNumber: string;
  binInternalId: string;
  warehouse: string;
  division: string;
  onHand: number;
  avgCost: number;
  totalValue: number;
  stockStatus: string;
  serialNumber: string;
}

// Column name mapping - maps various NetSuite export column names to our fields
const COLUMN_MAP: Record<string, keyof ImportedItem> = {
  // Item Internal ID (NetSuite) — NOT bin internal ID
  "item internal id": "internalId",
  "item_internal_id": "internalId",
  "item  internal id": "internalId",
  "internal id": "internalId",
  "internal_id": "internalId",
  "internalid": "internalId",
  "netsuite id": "internalId",
  "netsuite_id": "internalId",

  // Item Code
  "item": "itemCode",
  "item code": "itemCode",
  "item_code": "itemCode",
  "itemcode": "itemCode",
  "sku": "itemCode",
  "part number": "itemCode",
  "part_number": "itemCode",
  "product code": "itemCode",

  // Description
  "description": "description",
  "item description": "description",
  "desc": "description",
  "name": "description",
  "item name": "description",

  // Brand
  "brand": "brand",
  "manufacturer": "brand",
  "vendor": "brand",

  // Category
  "category": "category",
  "stock category": "category",
  "item category": "category",
  "type": "category",
  "item type": "category",

  // Bin Number
  "bin": "binNumber",
  "bin number": "binNumber",
  "bin_number": "binNumber",
  "location": "binNumber",
  "bin location": "binNumber",

  // Bin Internal ID (NetSuite)
  "bin internal id": "binInternalId",
  "bin_internal_id": "binInternalId",
  "bininternalid": "binInternalId",
  "bin location  internal id": "binInternalId",
  "bin location internal id": "binInternalId",
  "bin number  internal id": "binInternalId",
  "bin number internal id": "binInternalId",
  "bin  internal id": "binInternalId",
  "location internal id": "binInternalId",
  "location_internal_id": "binInternalId",

  // Warehouse
  "warehouse": "warehouse",
  "warehouse name": "warehouse",
  "wh": "warehouse",

  // Division
  "division": "division",
  "dept": "division",
  "department": "division",

  // On Hand
  "on hand": "onHand",
  "on_hand": "onHand",
  "onhand": "onHand",
  "qty": "onHand",
  "quantity": "onHand",
  "qty on hand": "onHand",
  "quantity on hand": "onHand",
  "stock on hand": "onHand",
  "soh": "onHand",

  // Average Cost
  "avg cost": "avgCost",
  "avg_cost": "avgCost",
  "average cost": "avgCost",
  "unit cost": "avgCost",
  "cost": "avgCost",
  "avg. cost": "avgCost",

  // Total Value
  "total value": "totalValue",
  "total_value": "totalValue",
  "value": "totalValue",
  "extended cost": "totalValue",
  "ext cost": "totalValue",
  "amount": "totalValue",

  // Stock Status
  "status": "stockStatus",
  "stock status": "stockStatus",
  "stock_status": "stockStatus",
  "item status": "stockStatus",
  "inventory status": "stockStatus",
  "availability": "stockStatus",

  // Serial Number
  "serial number": "serialNumber",
  "serial_number": "serialNumber",
  "serialnumber": "serialNumber",
  "serial #": "serialNumber",
  "serial": "serialNumber",
  "serial/lot number": "serialNumber",
  "serial/lot #": "serialNumber",
  "lot number": "serialNumber",
  "lot_number": "serialNumber",
  "lot #": "serialNumber",
  "lot": "serialNumber",
  "serial/lot": "serialNumber",
  "number": "serialNumber",
};

function normalizeColumnName(col: string): string {
  return col
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// COLUMN_MAP keyed by normalized name, so headers and keys normalize identically
// (e.g. "Serial/Lot Number" and "serial/lot number" both become "seriallot number").
const NORMALIZED_COLUMN_MAP: Record<string, keyof ImportedItem> = Object.fromEntries(
  Object.entries(COLUMN_MAP).map(([key, field]) => [normalizeColumnName(key), field])
);

/** Warehouse value stored for items imported with a blank warehouse, so they stay visible to warehouse filters. */
export const NO_WAREHOUSE = "(No warehouse)";

/** Normalize an imported warehouse value: blank/whitespace becomes NO_WAREHOUSE. */
export function normalizeWarehouse(val: string | null | undefined): string {
  const trimmed = (val ?? "").trim();
  return trimmed.length > 0 ? trimmed : NO_WAREHOUSE;
}

/**
 * Parse a numeric cell. Text cells may carry a currency marker ("R 12.50", "ZAR 5")
 * and thousands separators ("1,234", "1 234.5", "1,234.50"). Spaces and a leading
 * "R"/"ZAR" marker are stripped; commas are always thousands separators. Unparseable -> 0.
 */
export function parseNumericCell(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  let s = String(val ?? "").replace(/\s/g, ""); // \s includes non-breaking spaces
  let sign = "";
  if (s.startsWith("-")) {
    sign = "-";
    s = s.slice(1);
  }
  s = s.replace(/^(ZAR|R)/i, "");
  if (!sign && s.startsWith("-")) {
    sign = "-";
    s = s.slice(1);
  }
  const n = parseFloat(sign + s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface SpreadsheetSource {
  /** Original file name; a ".csv" extension selects strict comma-separated parsing. */
  filename?: string;
  /** MIME type of the upload, if known. */
  mimeType?: string;
}

/** True if the upload is a CSV file (by extension or MIME type). */
export function isCsvSource(source?: SpreadsheetSource): boolean {
  if (!source) return false;
  if (source.filename && /\.csv$/i.test(source.filename.trim())) return true;
  const mime = (source.mimeType || "").toLowerCase();
  return mime === "text/csv" || mime === "application/csv";
}

/**
 * Read an uploaded workbook. CSV files are always split on commas (SheetJS would
 * otherwise sniff ";" or tab as the separator) and keep their cells as text, so quoted
 * values like "1,234" and item codes like "0500" survive; numbers are parsed later.
 */
export function readWorkbook(buffer: ArrayBuffer, source?: SpreadsheetSource): XLSX.WorkBook {
  if (isCsvSource(source)) {
    return XLSX.read(buffer, { type: "array", FS: ",", raw: true });
  }
  return XLSX.read(buffer, { type: "array" });
}

/** Strip leading formula-injection characters from imported cell values */
function sanitizeCellValue(val: string): string {
  // Prevent Excel formula injection: strip leading =, @, tab, CR
  // Do NOT strip - or + as they are legitimate data characters (item codes, serial numbers)
  return val.replace(/^[=@\t\r]+/, "");
}

export function parseExcel(buffer: ArrayBuffer, source?: SpreadsheetSource): {
  items: ImportedItem[];
  headers: string[];
  mappedFields: string[];
  unmappedHeaders: string[];
  rowCount: number;
} {
  const workbook = readWorkbook(buffer, source);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // defval keeps a key for every header column even when a row's cell is blank;
  // without it, a blank cell in the first data row would hide the whole column.
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rawData.length === 0) {
    return {
      items: [],
      headers: [],
      mappedFields: [],
      unmappedHeaders: [],
      rowCount: 0,
    };
  }

  const headers = Object.keys(rawData[0]);
  const headerMapping: Record<string, keyof ImportedItem> = {};
  const mappedFields: string[] = [];
  const unmappedHeaders: string[] = [];

  for (const header of headers) {
    const normalized = normalizeColumnName(header);
    const mapped = NORMALIZED_COLUMN_MAP[normalized];
    if (mapped) {
      headerMapping[header] = mapped;
      mappedFields.push(`${header} -> ${mapped}`);
    } else {
      unmappedHeaders.push(header);
    }
  }

  const items: ImportedItem[] = rawData.map((row) => {
    const item: ImportedItem = {
      internalId: "",
      itemCode: "",
      description: "",
      brand: "",
      category: "",
      binNumber: "",
      binInternalId: "",
      warehouse: "",
      division: "",
      onHand: 0,
      avgCost: 0,
      totalValue: 0,
      stockStatus: "",
      serialNumber: "",
    };

    for (const [header, field] of Object.entries(headerMapping)) {
      const val = row[header];
      if (val === undefined || val === null || val === "") continue;

      if (field === "onHand" || field === "avgCost" || field === "totalValue") {
        item[field] = parseNumericCell(val);
      } else {
        item[field] = sanitizeCellValue(String(val).trim());
      }
    }

    // Treat NetSuite "- None -" as empty for serial numbers
    if (item.serialNumber === "- None -") {
      item.serialNumber = "";
    }

    // Calculate total value if not provided
    if (!item.totalValue && item.onHand && item.avgCost) {
      item.totalValue = item.onHand * item.avgCost;
    }

    return item;
  });

  // Filter out items without a code
  const validItems = items.filter((i) => i.itemCode && i.itemCode.length > 0);

  return {
    items: validItems,
    headers,
    mappedFields,
    unmappedHeaders,
    rowCount: rawData.length,
  };
}

export function exportToExcel(
  data: Record<string, unknown>[]
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Stocktake");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
