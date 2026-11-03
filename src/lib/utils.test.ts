import { describe, expect, it } from "vitest";
import { cn, normalizeMembers, safeJsonParse } from "./utils";

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(["a", "b"]);
    expect(safeJsonParse('{"x":1}', {})).toEqual({ x: 1 });
    expect(safeJsonParse("42", 0)).toBe(42);
  });

  it("returns the fallback for null and undefined", () => {
    const fallback = ["f"];
    expect(safeJsonParse(null, fallback)).toBe(fallback);
    expect(safeJsonParse(undefined, fallback)).toBe(fallback);
  });

  it("returns the fallback for invalid JSON, including the empty string", () => {
    expect(safeJsonParse("{oops", [])).toEqual([]);
    expect(safeJsonParse("", "fb")).toBe("fb");
  });

  it("returns a parsed JSON null rather than the fallback (no shape validation)", () => {
    expect(safeJsonParse<string[] | null>("null", [])).toBeNull();
    // Type parameter is not enforced at runtime
    expect(safeJsonParse<string[]>('{"not":"array"}', [])).toEqual({ not: "array" });
  });
});

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("p-2", false && "hidden", "p-4")).toBe("p-4");
  });
});

describe("normalizeMembers", () => {
  it("accepts arrays, JSON strings and plain text", () => {
    expect(normalizeMembers(["Ann", " Bob "])).toEqual(["Ann", "Bob"]);
    expect(normalizeMembers('["Ann","Bob"]')).toEqual(["Ann", "Bob"]);
    expect(normalizeMembers('"E2E"')).toEqual(["E2E"]);
    expect(normalizeMembers("Ann, Bob")).toEqual(["Ann", "Bob"]);
    expect(normalizeMembers(null)).toEqual([]);
    expect(normalizeMembers({})).toEqual([]);
  });
});
