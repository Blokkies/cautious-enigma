import { describe, expect, it } from "vitest";
import { parseExcel } from "./excel";
import { csvCell, sampleStockCsv, SAMPLE_STOCK_HEADERS } from "./sample-stock-csv";

function parseSample() {
  const bytes = new TextEncoder().encode(sampleStockCsv());
  return parseExcel(bytes.buffer as ArrayBuffer, { filename: "sample.csv" });
}

describe("sampleStockCsv", () => {
  it("uses only column headers the importer recognises", () => {
    const parsed = parseSample();
    expect(parsed.unmappedHeaders).toEqual([]);
    expect(parsed.mappedFields).toHaveLength(SAMPLE_STOCK_HEADERS.length);
  });

  it("imports every row, keeping leading zeros, quoted commas and thousands separators", () => {
    const { items } = parseSample();
    expect(items).toHaveLength(6);
    expect(items[0]).toMatchObject({ itemCode: "0500-BLT", description: "Bolt, M8 x 40 zinc", onHand: 1250 });
    expect(items[1].onHand).toBe(1400);
    expect(items[2].serialNumber).toBe("VT18-000123");
    // Missing total value is worked out from on hand x average cost
    expect(items[4].totalValue).toBeCloseTo(48 * 35.5);
    // Blank bin stays blank here; the import route turns it into "(No bin)"
    expect(items[5].binNumber).toBe("");
  });
});

describe("csvCell", () => {
  it("quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
