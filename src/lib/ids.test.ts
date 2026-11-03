import { describe, expect, it } from "vitest";
import { parseId } from "./ids";

describe("parseId", () => {
  it.each([
    [1, 1],
    [42, 42],
    ["7", 7],
    [" 7 ", 7],
    [2147483647, 2147483647],
  ])("accepts %j", (input, expected) => {
    expect(parseId(input)).toBe(expected);
  });

  it.each([0, -1, 1.5, NaN, Infinity, "", "abc", "1e3", "-3", "3.0", "0x10", null, undefined, {}, [1], true, 2147483648, "99999999999"])(
    "rejects %j",
    (input) => {
      expect(parseId(input)).toBeNull();
    }
  );
});
