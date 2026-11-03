/** Largest value a Postgres `integer` / `serial` column can hold. */
const PG_INT_MAX = 2_147_483_647;

/**
 * Parse a database id from untrusted input (JSON body, query string, route param).
 * Accepts a positive integer number or a string of digits; returns null for
 * anything else (NaN, floats, negatives, "abc", "", objects, out-of-range values)
 * so handlers can answer 400 instead of letting the query fail with a 500.
 */
export function parseId(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    n = Number(value.trim());
  } else {
    return null;
  }
  return Number.isInteger(n) && n > 0 && n <= PG_INT_MAX ? n : null;
}
