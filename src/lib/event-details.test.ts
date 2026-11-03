import { describe, expect, it } from "vitest";
import { hasDetailFields, parseIsoDate, validateEventDetails } from "./event-details";

describe("parseIsoDate", () => {
  it.each([
    ["2026-11-03", "2026-11-03"],
    ["2026-11-03T00:00:00.000Z", "2026-11-03"],
    [" 2026-02-28 ", "2026-02-28"],
    ["", null],
    [null, null],
  ])("accepts %j", (input, expected) => {
    expect(parseIsoDate(input)).toBe(expected);
  });

  it.each(["2026-02-30", "2026-13-01", "03/11/2026", "tomorrow", 20261103, {}])("rejects %j", (input) => {
    expect(parseIsoDate(input)).toBeUndefined();
  });
});

describe("validateEventDetails", () => {
  it("trims the name and returns only the fields present", () => {
    expect(validateEventDetails({ name: "  Year end  " })).toEqual({ ok: true, updates: { name: "Year end" } });
  });

  it.each([[""], ["   "], [null], [42]])("rejects name %j", (name) => {
    const r = validateEventDetails({ name });
    expect(r.ok).toBe(false);
  });

  it("rejects names over 200 characters", () => {
    expect(validateEventDetails({ name: "x".repeat(200) }).ok).toBe(true);
    expect(validateEventDetails({ name: "x".repeat(201) }).ok).toBe(false);
  });

  it("clears blank location and dates to null", () => {
    expect(validateEventDetails({ location: "  ", startDate: "", endDate: null })).toEqual({
      ok: true,
      updates: { location: null, startDate: null, endDate: null },
    });
  });

  it("rejects an end date before the start date", () => {
    const r = validateEventDetails({ startDate: "2026-11-05", endDate: "2026-11-04" });
    expect(r).toEqual({ ok: false, error: "End date cannot be before the start date" });
    expect(validateEventDetails({ startDate: "2026-11-05", endDate: "2026-11-05" }).ok).toBe(true);
  });

  it("checks a single changed date against the existing other date", () => {
    expect(validateEventDetails({ endDate: "2026-11-01" }, { startDate: "2026-11-02", endDate: null }).ok).toBe(false);
    expect(validateEventDetails({ startDate: "2026-11-09" }, { startDate: null, endDate: "2026-11-08" }).ok).toBe(false);
    expect(validateEventDetails({ startDate: null }, { startDate: "2026-11-09", endDate: "2026-11-08" }).ok).toBe(true);
  });

  it("does not re-check untouched dates when only the name changes", () => {
    expect(validateEventDetails({ name: "A" }, { startDate: "2026-11-09", endDate: "2026-11-08" }).ok).toBe(true);
  });

  it("hasDetailFields", () => {
    expect(hasDetailFields({ id: 1, status: "active" })).toBe(false);
    expect(hasDetailFields({ id: 1, location: null })).toBe(true);
  });
});
