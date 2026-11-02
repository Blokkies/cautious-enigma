import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

// postgres.js returns bigint (count) and numeric (sum of integers) as strings.
// These helpers cast in SQL and map in JS so aggregates always arrive as numbers.

/** count(*) as a real number, optionally with a FILTER (WHERE ...) clause. */
export function countInt(filter?: SQLWrapper): SQL<number> {
  return filter
    ? sql<number>`(count(*) FILTER (WHERE ${filter}))::int`.mapWith(Number)
    : sql<number>`count(*)::int`.mapWith(Number);
}

/** count(DISTINCT expr) as a real number. */
export function countDistinctInt(expr: SQLWrapper): SQL<number> {
  return sql<number>`count(DISTINCT ${expr})::int`.mapWith(Number);
}

/**
 * COALESCE(sum(expr), 0) as a float8 number, optionally with a FILTER (WHERE ...)
 * clause. Empty sets yield 0, never null.
 */
export function sumFloat(expr: SQLWrapper, filter?: SQLWrapper): SQL<number> {
  return filter
    ? sql<number>`COALESCE(sum(${expr}) FILTER (WHERE ${filter}), 0)::float8`.mapWith(Number)
    : sql<number>`COALESCE(sum(${expr}), 0)::float8`.mapWith(Number);
}
