import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { fake, execute } = vi.hoisted(() => ({
  fake: { current: null as null | ReturnType<typeof import("./fake-db").createFakeDb> },
  execute: { calls: 0 },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: unknown, vals: unknown[]) => ({ op: "in", col, vals }),
  and: (...conds: unknown[]) => ({ op: "and", conds: conds.filter(Boolean) }),
  asc: (col: unknown) => col,
}));

vi.mock("@/lib/db", async () => {
  const { createFakeDb } = await import("./fake-db");
  fake.current = createFakeDb();
  const db = fake.current.db;
  const realExecute = db.execute;
  db.execute = async () => {
    execute.calls++;
    return realExecute();
  };
  return { db };
});

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => ({ user: { id: 10, type: "team", name: "T", eventId: 1 } }),
  checkEventActive: async () => null,
}));

import { POST } from "../serial-discrepancies/route";
import { serialDiscrepancies } from "@/lib/db/schema";

const db = () => fake.current!;
const rows = () => db().rows(serialDiscrepancies);

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/team/serial-discrepancies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const entry = (clientId: string, unknownSerials = ["S1", "S2"], itemCode = "X") => ({
  itemCode, description: null, binNumber: "B", binInternalId: null, unknownSerials, clientId,
});

beforeEach(() => {
  db().reset();
  execute.calls = 0;
});

describe("POST /api/team/serial-discrepancies", () => {
  it("stores the clientId and deduplicates a replay of the same clientId", async () => {
    const first = await (await post(entry("c1"))).json();
    expect(first).toMatchObject({ success: true });
    expect(first.deduplicated).toBeUndefined();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ clientId: "c1", teamId: 10, eventId: 1, status: "open" });

    const again = await (await post({ batch: [entry("c1", ["S9"])] })).json();
    expect(again.results).toEqual([{ success: true, id: first.id, deduplicated: true }]);
    expect(rows()).toHaveLength(1);
  });

  it("treats the same serial set in a different order as a duplicate", async () => {
    await post(entry("c1", ["S1", "S2"]));
    const res = await (await post({ batch: [entry("c2", ["S2", "S1", "S2"])] })).json();
    expect(res.results[0]).toMatchObject({ success: true, deduplicated: true });
    expect(rows()).toHaveLength(1);
  });

  it("dedups within a single batch and still records genuinely different reports", async () => {
    const res = await (await post({
      batch: [entry("c1"), entry("c1"), entry("c3", ["S3"]), entry("c4", ["S1", "S2"], "OTHER")],
    })).json();
    expect(res.results.map((r: { deduplicated?: boolean }) => !!r.deduplicated)).toEqual([false, true, false, false]);
    expect(rows()).toHaveLength(3);
  });

  it("serializes each discrepancy under a transaction-scoped advisory lock", async () => {
    await post({ batch: [entry("c1"), entry("c2", ["S7"])] });
    expect(execute.calls).toBe(2);
  });

  it("validates entries", async () => {
    const res = await (await post({ batch: [{ clientId: "x", unknownSerials: ["S"] }, entry("y", [])] })).json();
    expect(res.results).toEqual([
      { success: false, error: "itemCode is required" },
      { success: false, error: "unknownSerials must be a non-empty array" },
    ]);
    expect((await post({ itemCode: "X", unknownSerials: [] })).status).toBe(400);
    expect(rows()).toHaveLength(0);
  });
});
