import { sql, type SQL } from "drizzle-orm";
import { NO_BIN } from "@/lib/no-bin";

/**
 * A bin reference. Bins are identified by (warehouse, bin_number): "A-01" in JHB and
 * "A-01" in CPT are different bins.
 * - `warehouse: string | null` matches that warehouse exactly (null / "" = items without one).
 * - `warehouse: undefined` is the legacy form (a bare bin-number string in the request);
 *   it matches the bin number in any warehouse, still limited by the event's warehouse scope.
 */
export interface BinRef {
  warehouse?: string | null;
  bin: string;
}

/**
 * Parse `bins` from a request body. Accepts objects `{ warehouse, bin }` (or `bin_number`)
 * and, for backward compatibility, plain bin-number strings. Returns null if malformed.
 */
export function parseBinRefs(raw: unknown): BinRef[] | null {
  if (!Array.isArray(raw)) return null;
  const refs: BinRef[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      refs.push({ bin: entry });
      continue;
    }
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const bin = typeof e.bin === "string" ? e.bin : typeof e.bin_number === "string" ? e.bin_number : null;
      if (bin === null) return null;
      const wh = e.warehouse;
      if (wh !== null && wh !== undefined && typeof wh !== "string") return null;
      refs.push({ bin, warehouse: wh ?? null });
      continue;
    }
    return null;
  }
  return refs;
}

/**
 * SQL condition matching items in any of the given bins. `alias` prefixes the column
 * names (e.g. "i" for `i.bin_number`). Returns a FALSE condition for an empty list.
 */
export function binRefsCondition(refs: BinRef[], alias?: string): SQL {
  if (refs.length === 0) return sql`FALSE`;
  const prefix = alias ? `${alias}.` : "";
  const binCol = sql.raw(`${prefix}bin_number`);
  const whCol = sql.raw(`${prefix}warehouse`);
  const parts = refs.map((r) => {
    // NO_BIN also matches blank bins not yet normalized (rows predating the backfill)
    const binCond =
      r.bin === NO_BIN
        ? sql`(${binCol} = ${r.bin} OR ${binCol} IS NULL OR trim(${binCol}) = '')`
        : sql`${binCol} = ${r.bin}`;
    return r.warehouse === undefined
      ? sql`(${binCond})`
      : sql`(COALESCE(${whCol}, '') = ${r.warehouse ?? ""} AND ${binCond})`;
  });
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * The bin number to group/list items by: blank bins read as NO_BIN, so every item shows
 * up in some bin on the assignment page (matching binRefsCondition's NO_BIN handling).
 */
export function binNumberExpr(alias?: string): SQL {
  const col = sql.raw(`${alias ? `${alias}.` : ""}bin_number`);
  // Inlined as a literal (a constant) so the same expression can appear in SELECT and GROUP BY
  return sql`(CASE WHEN ${col} IS NULL OR trim(${col}) = '' THEN ${sql.raw(`'${NO_BIN}'`)} ELSE ${col} END)`;
}

/**
 * Items-scope fragment (leading " AND ...") for the event's warehouse selection and an
 * optional brand filter. `alias` prefixes column names.
 */
export function itemScopeFragment(warehouses: string[] | null, brand?: string | null, alias?: string): SQL {
  const prefix = alias ? `${alias}.` : "";
  const parts: SQL[] = [];
  if (warehouses && warehouses.length > 0) {
    parts.push(sql` AND ${sql.raw(`${prefix}warehouse`)} IN (${sql.join(warehouses.map((w) => sql`${w}`), sql`, `)})`);
  }
  if (brand) {
    parts.push(sql` AND ${sql.raw(`${prefix}brand`)} = ${brand}`);
  }
  return parts.length > 0 ? sql.join(parts, sql``) : sql``;
}
