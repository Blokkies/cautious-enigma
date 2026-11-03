import { describe, expect, it } from "vitest";
import { formatDate, formatDateRange, formatMoney, formatNumber } from "./format";

describe("formatNumber", () => {
  it.each([
    [0, 0, "0"],
    [999, 0, "999"],
    [1234, 0, "1 234"],
    [1234567.891, 2, "1 234 567.89"],
    [-1234.4, 0, "-1 234"],
    [-0.001, 2, "0.00"],
    [NaN, 0, "0"],
  ])("%s (%s dp) -> %s", (value, dp, expected) => {
    expect(formatNumber(value, dp)).toBe(expected);
  });
});

describe("formatMoney", () => {
  it("formats Rand with space thousands and 2 decimals", () => {
    expect(formatMoney(1234.56)).toBe("R 1 234.56");
    expect(formatMoney(0)).toBe("R 0.00");
    expect(formatMoney(null)).toBe("R 0.00");
  });

  it("puts the sign before the currency", () => {
    expect(formatMoney(-1234.5)).toBe("-R 1 234.50");
    expect(formatMoney(1234.5, { signed: true })).toBe("+R 1 234.50");
    expect(formatMoney(0, { signed: true })).toBe("R 0.00");
  });

  it("supports whole-Rand tiles", () => {
    expect(formatMoney(1234567.6, { decimals: 0 })).toBe("R 1 234 568");
    expect(formatMoney(-0.4, { decimals: 0 })).toBe("R 0");
  });
});

describe("formatDate / formatDateRange", () => {
  it("formats ISO dates", () => {
    expect(formatDate("2026-11-03")).toBe("3 Nov 2026");
    expect(formatDate("2026-01-15T10:00:00Z")).toBe("15 Jan 2026");
    expect(formatDate("garbage")).toBe("");
    expect(formatDate(null)).toBe("");
  });

  it("formats ranges", () => {
    expect(formatDateRange("2026-11-03", "2026-11-05")).toBe("3 Nov 2026 – 5 Nov 2026");
    expect(formatDateRange("2026-11-03", "2026-11-03")).toBe("3 Nov 2026");
    expect(formatDateRange("2026-11-03", null)).toBe("From 3 Nov 2026");
    expect(formatDateRange(null, "2026-11-05")).toBe("Until 5 Nov 2026");
    expect(formatDateRange(null, null)).toBe("");
  });
});
