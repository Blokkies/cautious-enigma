/**
 * Minimal in-memory stand-in for the drizzle `db` used by the team routes.
 * Pair it with a vi.mock("drizzle-orm") whose eq/and/inArray/asc return the
 * plain `Cond` objects below (see count-route.test.ts).
 */
import { getTableColumns, getTableName, type Table } from "drizzle-orm";

type Row = Record<string, unknown>;
type Cond =
  | { op: "eq"; col: unknown; val: unknown }
  | { op: "in"; col: unknown; vals: unknown[] }
  | { op: "and"; conds: Cond[] }
  | undefined;

// Unique keys (JS property names) enforced on insert; null parts never conflict.
const UNIQUE_KEYS: Record<string, string[][]> = {
  counts: [["clientId", "teamId"], ["verificationId"]],
  serial_discrepancies: [["clientId", "teamId"]],
};

export function createFakeDb() {
  const tables = new Map<string, Row[]>();
  let nextId = 1;
  /** Called when a SELECT ... FOR UPDATE on the named table runs (before it reads). */
  const lockHooks = new Map<string, () => void>();

  const rowsOf = (table: Table) => {
    const name = getTableName(table);
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  const keyOf = (table: Table, col: unknown): string => {
    const entry = Object.entries(getTableColumns(table)).find(([, c]) => c === col);
    if (!entry) throw new Error(`Unknown column for ${getTableName(table)}`);
    return entry[0];
  };

  const matches = (table: Table, row: Row, cond: Cond): boolean => {
    if (!cond) return true;
    if (cond.op === "and") return cond.conds.every((c) => matches(table, row, c));
    if (cond.op === "eq") return row[keyOf(table, cond.col)] === cond.val;
    return cond.vals.includes(row[keyOf(table, cond.col)]);
  };

  const withDefaults = (table: Table, values: Row): Row => {
    const row: Row = {};
    for (const [key, col] of Object.entries(getTableColumns(table))) {
      const c = col as unknown as { hasDefault: boolean; default: unknown };
      row[key] = c.hasDefault && (typeof c.default !== "object" || c.default === null) ? c.default : null;
    }
    return { ...row, id: nextId++, ...values };
  };

  const project = (table: Table, row: Row, fields?: Record<string, unknown>) => {
    if (!fields) return { ...row };
    const out: Row = {};
    for (const [alias, col] of Object.entries(fields)) out[alias] = row[keyOf(table, col)];
    return out;
  };

  const thenable = <T>(run: () => T) => ({
    then<R1 = T, R2 = never>(ok?: (v: T) => R1 | PromiseLike<R1>, err?: (e: unknown) => R2 | PromiseLike<R2>) {
      return Promise.resolve().then(run).then(ok, err);
    },
  });

  const db = {
    select(fields?: Record<string, unknown>) {
      return {
        from(table: Table) {
          let cond: Cond;
          let locked = false;
          const run = () => {
            if (locked) lockHooks.get(getTableName(table))?.();
            return rowsOf(table)
              .filter((r) => matches(table, r, cond))
              .map((r) => project(table, r, fields));
          };
          const chain = {
            where(c: Cond) { cond = c; return chain; },
            orderBy() { return chain; },
            for() { locked = true; return chain; },
            ...thenable(run),
          };
          return chain;
        },
      };
    },

    insert(table: Table) {
      return {
        values(values: Row) {
          let ignoreConflicts = false;
          let returning: Record<string, unknown> | undefined;
          let wantsRows = false;
          const run = () => {
            const row = withDefaults(table, values);
            const existing = rowsOf(table);
            const conflict = (UNIQUE_KEYS[getTableName(table)] || []).some((keys) =>
              keys.every((k) => row[k] != null) &&
              existing.some((e) => keys.every((k) => e[k] === row[k]))
            );
            if (conflict) {
              if (ignoreConflicts) return [];
              throw new Error("unique violation");
            }
            existing.push(row);
            return wantsRows ? [project(table, row, returning)] : [];
          };
          const chain = {
            onConflictDoNothing() { ignoreConflicts = true; return chain; },
            returning(fields?: Record<string, unknown>) { wantsRows = true; returning = fields; return chain; },
            ...thenable(run),
          };
          return chain;
        },
      };
    },

    update(table: Table) {
      return {
        set(values: Row) {
          return {
            where(cond: Cond) {
              return thenable(() => {
                for (const r of rowsOf(table)) if (matches(table, r, cond)) Object.assign(r, values);
              });
            },
          };
        },
      };
    },

    async execute() {
      return [];
    },

    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return {
    db,
    /** Rows of a table (live references). */
    rows: (table: Table) => rowsOf(table),
    /** Insert a row directly (defaults applied); returns it. */
    seed: (table: Table, values: Row) => {
      const row = withDefaults(table, values);
      rowsOf(table).push(row);
      return row;
    },
    onLock: (table: Table, fn: () => void) => lockHooks.set(getTableName(table), fn),
    reset: () => {
      tables.clear();
      lockHooks.clear();
      nextId = 1;
    },
  };
}
