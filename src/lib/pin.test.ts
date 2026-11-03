import { describe, expect, it } from "vitest";
import { normalizePin } from "./pin";

describe("normalizePin", () => {
  it.each([
    ["1234", "1234"],
    ["0500", "0500"],
    ["123456", "123456"],
    [" 1234 ", "1234"],
    [1234, "1234"],
    [123456, "123456"],
  ])("accepts %j", (input, expected) => {
    expect(normalizePin(input)).toBe(expected);
  });

  it.each(["123", "1234567", "12a4", "12 34", "", 123, 1234567, -1234, 12.34, null, undefined, {}, ["1234"]])(
    "rejects %j",
    (input) => {
      expect(normalizePin(input)).toBeNull();
    }
  );
});
