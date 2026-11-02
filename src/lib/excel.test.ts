import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { exportToExcel, parseExcel, parseNumericCell } from "./excel";
import { generateTeamTemplate, parseTeamExcel } from "./team-excel";

function workbookFromRows(rows: unknown[][], sheetName = "Sheet1"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

function readBack(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return { sheetNames: wb.SheetNames, rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) };
}

describe("exportToExcel", () => {
  it("writes a single 'Stocktake' sheet with object keys as headers", () => {
    const bytes = exportToExcel([
      { "Item Code": "A1", Counted: 3 },
      { "Item Code": "B2", Counted: 0 },
    ]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const { sheetNames, rows } = readBack(bytes);
    expect(sheetNames).toEqual(["Stocktake"]);
    expect(rows).toEqual([
      ["Item Code", "Counted"],
      ["A1", 3],
      ["B2", 0],
    ]);
  });
});

describe("parseExcel", () => {
  it("maps NetSuite-style headers, coerces numbers and computes missing totalValue", () => {
    const buf = workbookFromRows([
      ["Item", "Description", "Bin Number", "On Hand", "Avg. Cost", "Serial Number", "Mystery"],
      ["A1", "Widget", "B-01", 4, "2.5", "- None -", "x"],
      ["", "No code", "B-02", 1, 1, "", "y"],
      ["=CMD()", "@evil", "B-03", "abc", 1, "SN-1", "z"],
    ]);
    const result = parseExcel(buf);

    expect(result.rowCount).toBe(3);
    expect(result.headers).toEqual(["Item", "Description", "Bin Number", "On Hand", "Avg. Cost", "Serial Number", "Mystery"]);
    expect(result.unmappedHeaders).toEqual(["Mystery"]);
    expect(result.mappedFields).toContain("Avg. Cost -> avgCost");

    // Row without an item code is dropped
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      itemCode: "A1",
      description: "Widget",
      binNumber: "B-01",
      onHand: 4,
      avgCost: 2.5,
      totalValue: 10,
      serialNumber: "", // "- None -" is treated as empty
    });
    // Formula-injection prefixes are stripped; unparsable numbers become 0
    expect(result.items[1]).toMatchObject({ itemCode: "CMD()", description: "evil", onHand: 0, serialNumber: "SN-1" });
  });

  it("returns an empty result for a sheet without data rows", () => {
    expect(parseExcel(workbookFromRows([["Item", "Qty"]]))).toEqual({
      items: [],
      headers: [],
      mappedFields: [],
      unmappedHeaders: [],
      rowCount: 0,
    });
  });

  it.each(["Serial/Lot Number", "Serial/Lot #", "Serial/Lot", "SERIAL/LOT NUMBER"])(
    "maps the '%s' header to serialNumber",
    (header) => {
      // Headers and COLUMN_MAP keys are normalized the same way, so "/" can't break the lookup.
      const result = parseExcel(workbookFromRows([["Item", header], ["A1", "SN-9"]]));
      expect(result.unmappedHeaders).toEqual([]);
      expect(result.items[0].serialNumber).toBe("SN-9");
    }
  );

  it("maps headers whose punctuation leaves runs of spaces", () => {
    const result = parseExcel(workbookFromRows([["Item", "Bin Location : Internal ID"], ["A1", "77"]]));
    expect(result.unmappedHeaders).toEqual([]);
    expect(result.items[0].binInternalId).toBe("77");
  });

  it("parses thousands-separated text numbers, keeping decimals", () => {
    const result = parseExcel(
      workbookFromRows([
        ["Item", "Qty", "Avg Cost", "Total Value"],
        ["A1", "1,234", "1,000.50", "1 234 567.25"],
      ])
    );
    expect(result.items[0]).toMatchObject({ onHand: 1234, avgCost: 1000.5, totalValue: 1234567.25 });
  });
});

describe("parseNumericCell", () => {
  it.each([
    [42, 42],
    [1.5, 1.5],
    [Number.NaN, 0],
    ["1,234", 1234],
    ["-1,234.5", -1234.5],
    [" 12 ", 12],
    ["1 234", 1234],
    ["abc", 0],
    ["", 0],
  ] as const)("%j -> %j", (input, expected) => {
    expect(parseNumericCell(input)).toBe(expected);
  });
});

describe("generateTeamTemplate", () => {
  it("produces a 'Teams' sheet with Team Name / PIN / Members headers and text PINs", () => {
    const { sheetNames, rows } = readBack(generateTeamTemplate());
    expect(sheetNames).toEqual(["Teams"]);
    expect(rows[0]).toEqual(["Team Name", "PIN", "Members"]);
    expect(rows[3]).toEqual(["Office Team", "0500", "Eve"]); // leading zero preserved
  });

  it("round-trips through parseTeamExcel", () => {
    const result = parseTeamExcel(generateTeamTemplate().buffer as ArrayBuffer);
    expect(result.errors).toEqual([]);
    expect(result.totalRows).toBe(3);
    expect(result.validTeams).toEqual([
      { name: "Warehouse A", pin: "1001", members: ["Alice", "Bob"] },
      { name: "Warehouse B", pin: "1002", members: ["Charlie", "Diana"] },
      { name: "Office Team", pin: "0500", members: ["Eve"] },
    ]);
  });
});

describe("parseTeamExcel", () => {
  it("validates rows and reports Excel row numbers", () => {
    const result = parseTeamExcel(
      workbookFromRows([
        ["Team", "PIN Code", "People"],
        ["Alpha", "12-34", " a , ,b "],
        ["alpha", "9999", ""],
        ["", "1234", ""],
        ["Beta", "", ""],
        ["Gamma", "12", ""],
        ["", "", ""],
      ])
    );
    expect(result.validTeams).toEqual([{ name: "Alpha", pin: "1234", members: ["a", "b"] }]);
    expect(result.errors).toEqual([
      { row: 3, message: 'Duplicate team name: "alpha"' },
      { row: 4, message: "Team name is empty" },
      { row: 5, message: 'Team "Beta": PIN is empty' },
      { row: 6, message: 'Team "Gamma": PIN must be at least 4 digits (got "12")' },
    ]);
  });

  it("requires Team Name and PIN columns", () => {
    expect(parseTeamExcel(workbookFromRows([["PIN"], ["1234"]])).errors).toEqual([
      { row: 0, message: "Missing required column: Team Name" },
    ]);
    expect(parseTeamExcel(workbookFromRows([["Team Name"], ["A"]])).errors).toEqual([
      { row: 0, message: "Missing required column: PIN" },
    ]);
  });

  it("reports an empty file", () => {
    expect(parseTeamExcel(workbookFromRows([["Team Name", "PIN"]]))).toEqual({
      validTeams: [],
      errors: [{ row: 0, message: "File is empty or has no data rows" }],
      totalRows: 0,
    });
  });
});
