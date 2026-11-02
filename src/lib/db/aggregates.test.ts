import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { countDistinctInt, countInt, sumFloat } from "./aggregates";

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q).sql;
// postgres.js hands bigint/numeric aggregates over as strings; the decoder must turn them into numbers.
const decode = (q: SQL, raw: unknown) =>
  (q as unknown as { decoder: { mapFromDriverValue: (v: unknown) => unknown } }).decoder.mapFromDriverValue(raw);

describe("aggregate helpers", () => {
  it("countInt casts count(*) to int, optionally filtered", () => {
    expect(render(countInt())).toBe("count(*)::int");
    expect(render(countInt(sql`variance > 0`))).toBe("(count(*) FILTER (WHERE variance > 0))::int");
  });

  it("countDistinctInt casts count(DISTINCT expr) to int", () => {
    expect(render(countDistinctInt(sql`bin_number`))).toBe("count(DISTINCT bin_number)::int");
  });

  it("sumFloat coalesces to 0 and casts to float8, optionally filtered", () => {
    expect(render(sumFloat(sql`abs(variance_value)`))).toBe("COALESCE(sum(abs(variance_value)), 0)::float8");
    expect(render(sumFloat(sql`x`, sql`y < 0`))).toBe("COALESCE(sum(x) FILTER (WHERE y < 0), 0)::float8");
  });

  it.each([
    [countInt(), "12", 12],
    [countDistinctInt(sql`a`), "3", 3],
    [sumFloat(sql`a`), "1234.5", 1234.5],
    [sumFloat(sql`a`), 7, 7],
  ] as const)("maps driver value %#", (q, raw, expected) => {
    expect(decode(q, raw)).toBe(expected);
  });
});
