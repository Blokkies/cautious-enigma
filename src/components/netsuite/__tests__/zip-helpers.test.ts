import { describe, expect, it } from "vitest";
import { classifyExportResponse, sanitizeFolderName, uniqueFolderNames } from "../zip-helpers";

describe("sanitizeFolderName", () => {
  it("replaces unsafe characters", () => {
    expect(sanitizeFolderName("Stock/Take: 2026")).toBe("Stock_Take_ 2026");
  });
});

describe("uniqueFolderNames", () => {
  it("keeps distinct names unchanged", () => {
    const m = uniqueFolderNames([
      { id: 1, name: "Jan Count" },
      { id: 2, name: "Feb Count" },
    ]);
    expect(m.get(1)).toBe("Jan Count");
    expect(m.get(2)).toBe("Feb Count");
  });

  it("appends the event id when sanitized names collide", () => {
    const m = uniqueFolderNames([
      { id: 3, name: "Stock/Take" },
      { id: 7, name: "Stock_Take" },
      { id: 9, name: "stock_take" },
    ]);
    expect(m.get(3)).toBe("Stock_Take_3");
    expect(m.get(7)).toBe("Stock_Take_7");
    expect(m.get(9)).toBe("stock_take_9");
  });

  it("appends the id for identical names and empty sanitized names", () => {
    const m = uniqueFolderNames([
      { id: 1, name: "Same" },
      { id: 2, name: "Same" },
      { id: 4, name: "" },
    ]);
    expect(m.get(1)).toBe("Same_1");
    expect(m.get(2)).toBe("Same_2");
    expect(m.get(4)).toBe("event_4");
  });

  it("never yields duplicate folders even when a suffixed name matches a literal one", () => {
    const m = uniqueFolderNames([
      { id: 2, name: "A" },
      { id: 5, name: "A" },
      { id: 6, name: "A_2" },
    ]);
    const folders = Array.from(m.values()).map((f) => f.toLowerCase());
    expect(new Set(folders).size).toBe(3);
  });
});

describe("classifyExportResponse", () => {
  it("treats 2xx as ok", () => {
    expect(classifyExportResponse(200, null)).toBe("ok");
  });

  it("treats the plain-text 404 'No data' as empty", () => {
    expect(classifyExportResponse(404, "No data")).toBe("empty");
  });

  it("treats other failures as errors", () => {
    expect(classifyExportResponse(404, '{"error":"No event to export"}')).toBe("error");
    expect(classifyExportResponse(500, "Internal error")).toBe("error");
    expect(classifyExportResponse(401, "")).toBe("error");
  });
});
