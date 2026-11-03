// Test helper: a recording stand-in for the drizzle `db` object.
// Every query chain (db.select(...).from(...).where(...), tx.update(...).set(...), tx.execute(sql))
// is recorded as a QueryRecord; awaiting it resolves to whatever `respond(record)` returns.
// db.transaction(fn) runs fn with a tx that records into the same log (flagged inTx), and
// rethrows fn's error like a rolled-back transaction would.
import { getTableName, is, SQL, Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

export interface QueryRecord {
  op: "select" | "insert" | "update" | "delete" | "execute";
  table: string | null;
  /** Keys of the select({...}) projection. */
  fields: string[];
  /** Method calls after the first one, e.g. ["where", [cond]]. */
  calls: [string, unknown[]][];
  /** Rendered SQL text for db.execute(sql`...`). */
  text: string | null;
  inTx: boolean;
}

const dialect = new PgDialect();

/** Render a drizzle SQL object to its query text (params as $1, $2, ...). */
export function sqlText(value: unknown): string {
  return is(value, SQL) ? dialect.sqlToQuery(value).sql : "";
}

/** Rendered SQL + params. */
export function sqlQuery(value: SQL) {
  return dialect.sqlToQuery(value);
}

export function createMockDb(respond: (rec: QueryRecord) => unknown) {
  const log: QueryRecord[] = [];

  function chain(rec: QueryRecord): unknown {
    const target = function () {};
    const proxy: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => respond(rec))
              .then(resolve, reject);
        }
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          if ((prop === "from" || prop === "insert" || prop === "update" || prop === "delete") && is(args[0], Table)) {
            rec.table = getTableName(args[0] as Table);
          }
          rec.calls.push([prop, args]);
          return proxy;
        };
      },
    });
    return proxy;
  }

  function makeHandle(inTx: boolean) {
    const start = (op: QueryRecord["op"], first: unknown[]) => {
      const rec: QueryRecord = { op, table: null, fields: [], calls: [], text: null, inTx };
      if (op === "select" && first[0] && typeof first[0] === "object") rec.fields = Object.keys(first[0] as object);
      if (op !== "select" && op !== "execute" && is(first[0], Table)) rec.table = getTableName(first[0] as Table);
      if (op === "execute") rec.text = sqlText(first[0]);
      log.push(rec);
      return chain(rec);
    };
    return {
      select: (...a: unknown[]) => start("select", a),
      insert: (...a: unknown[]) => start("insert", a),
      update: (...a: unknown[]) => start("update", a),
      delete: (...a: unknown[]) => start("delete", a),
      execute: (...a: unknown[]) => start("execute", a),
    };
  }

  const tx = makeHandle(true);
  let transactions = 0;
  const db = {
    ...makeHandle(false),
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      transactions++;
      return fn(tx);
    },
  };

  return {
    db,
    log,
    transactionCount: () => transactions,
    reset: () => {
      log.length = 0;
      transactions = 0;
    },
  };
}

/** Whether the record's chain includes a call to `method`. */
export function hasCall(rec: QueryRecord, method: string): boolean {
  return rec.calls.some(([m]) => m === method);
}

/** Arguments of the first call to `method` in the record's chain. */
export function callArgs(rec: QueryRecord, method: string): unknown[] | undefined {
  return rec.calls.find(([m]) => m === method)?.[1];
}

export const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-user-id": "1",
  "x-user-type": "admin",
  "x-user-name": "Root",
  "x-event-id": "0",
};
