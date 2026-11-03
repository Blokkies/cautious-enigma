import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Programmable db mock: every awaited select chain resolves to the next queued
// result (in query order); updates / inserts / orderBy calls are recorded.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as { table: unknown; values: Record<string, unknown> }[],
  inserts: [] as { table: unknown; values: unknown }[],
  orderedTables: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const makeSelect = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    for (const m of ["innerJoin", "where", "limit", "for", "groupBy"]) chain[m] = () => chain;
    chain.from = (t: unknown) => {
      table = t;
      return chain;
    };
    chain.orderBy = () => {
      h.orderedTables.push(table);
      return chain;
    };
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(h.selects.shift() ?? []).then(res, rej);
    return chain;
  };
  const db = {
    select: () => makeSelect(),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          h.updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        h.inserts.push({ table, values });
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: 999 }]) });
      },
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});

vi.mock("@/lib/api-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    requireUser: async () => ({ user: { id: 7, type: "supervisor", name: "S", eventId: 1 } }),
    checkEventActive: async () => null,
    getEventWarehouses: async () => null,
  };
});

import { GET as getVariances, PATCH as patchVariances } from "../variances/route";
import { POST as postVerification } from "../verifications/route";
import { PATCH as patchSerialReview } from "../serial-review/route";
import { counts, serialDiscrepancies, verificationAssignments } from "@/lib/db/schema";

beforeEach(() => {
  h.selects.length = 0;
  h.updates.length = 0;
  h.inserts.length = 0;
  h.orderedTables.length = 0;
});

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const patchV = (body: unknown) => patchVariances(req("/api/supervisor/variances", "PATCH", body));
const updatesTo = (table: unknown) => h.updates.filter((u) => u.table === table).map((u) => u.values);

const editableCount = { countId: 5, countedQty: 3, variance: -2, eventId: 1, onHand: 5, avgCost: 10, isSerialized: false };

describe("variances PATCH: accept / edit vs. pending verifications (bug 1)", () => {
  it("rejects accept_variance with 409 while a recount is pending", async () => {
    h.selects.push([{ id: 5, eventId: 1 }], [{ id: 10, countId: 5, status: "pending" }]);
    const res = await patchV({ action: "accept_variance", countId: 5 });
    expect(res.status).toBe(409);
    expect(h.updates).toEqual([]);
  });

  it("rejects a qty edit with 409 while a recount is pending, so the recount can't later replace it", async () => {
    h.selects.push([editableCount], [{ id: 10, countId: 5, status: "pending" }]);
    const res = await patchV({ countId: 5, newQty: 8 });
    expect(res.status).toBe(409);
    expect(h.updates).toEqual([]);
    expect(h.inserts).toEqual([]);
  });

  it("closes a completed-but-undecided verification when accepting directly", async () => {
    h.selects.push([{ id: 5, eventId: 1 }], [{ id: 10, countId: 5, status: "completed" }]);
    const res = await patchV({ action: "accept_variance", countId: 5 });
    expect(res.status).toBe(200);
    expect(updatesTo(verificationAssignments)).toEqual([{ status: "accepted" }]);
    expect(updatesTo(counts)).toEqual([{ checkStatus: "accepted" }]);
  });

  it("closes a completed-but-undecided verification when editing the qty", async () => {
    h.selects.push([editableCount], [{ id: 10, countId: 5, status: "completed" }]);
    const res = await patchV({ countId: 5, newQty: 8 });
    expect(res.status).toBe(200);
    expect(updatesTo(verificationAssignments)).toEqual([{ status: "accepted" }]);
    expect(updatesTo(counts)).toEqual([
      { countedQty: 8, variance: 3, varianceValue: 30, isMatch: false, checkStatus: "accepted" },
    ]);
  });

  it("edits normally when there is no open verification", async () => {
    h.selects.push([editableCount], []);
    const res = await patchV({ countId: 5, newQty: 5 });
    expect(res.status).toBe(200);
    expect(updatesTo(verificationAssignments)).toEqual([]);
    expect(updatesTo(counts)).toHaveLength(1);
  });

  it("bulk accept skips counts with a pending recount and reports how many", async () => {
    h.selects.push(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [
        { id: 10, countId: 2, status: "pending" },
        { id: 11, countId: 3, status: "completed" },
      ]
    );
    const res = await patchV({ action: "bulk_accept_variance", countIds: [1, 2, 3] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ acceptedCount: 2, acceptedIds: [1, 3], skippedPendingVerification: 1 });
    expect(updatesTo(counts)).toEqual([{ checkStatus: "accepted" }]);
    expect(updatesTo(verificationAssignments)).toEqual([{ status: "accepted" }]);
    const audit = h.inserts[0].values as { recordId: number }[];
    expect(audit.map((a) => a.recordId)).toEqual([1, 3]);
  });

  it("bulk accept returns 409 when every selected count has a pending recount", async () => {
    h.selects.push([{ id: 2 }], [{ id: 10, countId: 2, status: "pending" }]);
    const res = await patchV({ action: "bulk_accept_variance", countIds: [2] });
    expect(res.status).toBe(409);
    expect((await res.json()).skippedPendingVerification).toBe(1);
    expect(h.updates).toEqual([]);
  });
});

describe("variances PATCH: reopen after an accepted verification (bug 5)", () => {
  it("puts the decided verification back to completed and keeps the counted qty", async () => {
    h.selects.push([{ id: 5, eventId: 1 }], [{ id: 10, status: "accepted" }]);
    const res = await patchV({ action: "reopen_variance", countId: 5 });
    expect(res.status).toBe(200);
    expect(updatesTo(verificationAssignments)).toEqual([{ status: "completed" }]);
    // verification count row back to unaccepted, initial count back to pending; qty untouched
    expect(updatesTo(counts)).toEqual([{ checkStatus: "pending" }, { checkStatus: "pending" }]);
  });
});

describe("verification creation and selection (bug 4)", () => {
  const post = (body: unknown) => postVerification(req("/api/supervisor/verifications", "POST", body));

  it.each(["pending", "completed"])("blocks a new verification while one is %s", async (status) => {
    h.selects.push([{ id: 4 }], [{ id: 5, itemId: 50, eventId: 1, isMatch: false }], [{ itemId: 50, status }]);
    const res = await post({ countIds: [5], assignedTeamId: 4 });
    expect(res.status).toBe(409);
    expect(h.inserts).toEqual([]);
  });

  it("allows a new verification once the earlier one was decided", async () => {
    h.selects.push([{ id: 4 }], [{ id: 5, itemId: 50, eventId: 1, isMatch: false }], []);
    const res = await post({ countIds: [5], assignedTeamId: 4 });
    expect(res.status).toBe(200);
    expect(h.inserts.filter((i) => i.table === verificationAssignments)).toHaveLength(1);
  });

  it("orders verifications by id so the latest one is shown", async () => {
    const row = { countId: 5, itemCode: "X", variance: -1, varianceValue: -10 };
    h.selects.push(
      [row],
      [
        { id: 3, countId: 5, status: "accepted", teamName: "Old", teamId: 1, completedAt: null },
        { id: 7, countId: 5, status: "pending", teamName: "New", teamId: 2, completedAt: null },
      ],
      [] // verification count rows
    );
    const res = await getVariances(req("/api/supervisor/variances", "GET"));
    expect(res.status).toBe(200);
    expect(h.orderedTables).toContain(verificationAssignments);
    const { variances } = await res.json();
    expect(variances[0]).toMatchObject({ verificationId: 7, verificationStatus: "pending" });
  });
});

describe("serial-review PATCH resolve (bug 3)", () => {
  const patchS = (body: unknown) => patchSerialReview(req("/api/supervisor/serial-review", "PATCH", body));

  it("moves unknown serials into approvedSerials when resolving as approved", async () => {
    h.selects.push([{ verificationStatus: null, unknownSerials: '["S1","S2"]', approvedSerials: '["S0","S1"]' }]);
    const res = await patchS({ discrepancyId: 3, resolution: "ok" });
    expect(res.status).toBe(200);
    expect(updatesTo(serialDiscrepancies)).toEqual([
      expect.objectContaining({
        status: "resolved",
        resolutionType: "approved",
        unknownSerials: "[]",
        approvedSerials: '["S0","S1","S2"]',
      }),
    ]);
  });

  it("leaves the serial lists alone when dismissing", async () => {
    h.selects.push([{ verificationStatus: null, unknownSerials: '["S1"]', approvedSerials: null }]);
    const res = await patchS({ discrepancyId: 3, resolutionType: "dismissed" });
    expect(res.status).toBe(200);
    const [update] = updatesTo(serialDiscrepancies);
    expect(update).toMatchObject({ status: "resolved", resolutionType: "dismissed" });
    expect(update).not.toHaveProperty("approvedSerials");
    expect(update).not.toHaveProperty("unknownSerials");
  });

  it("refuses to resolve while verification is pending", async () => {
    h.selects.push([{ verificationStatus: "pending", unknownSerials: '["S1"]', approvedSerials: null }]);
    const res = await patchS({ discrepancyId: 3 });
    expect(res.status).toBe(409);
    expect(h.updates).toEqual([]);
  });

  it("override-expected refuses an accepted count and appends to the team comment otherwise (bug 2)", async () => {
    const item = { id: 9, eventId: 1, onHand: 1, avgCost: 10, serialNumber: "SN9", teamId: 2 };
    h.selects.push([item], [{ id: 5, countedQty: 1, checkStatus: "accepted", comment: "team note" }]);
    let res = await patchS({ discrepancyId: 3, action: "override-expected", itemId: 9, newStatus: "not_found" });
    expect(res.status).toBe(409);
    expect(h.updates).toEqual([]);

    h.selects.push([item], [{ id: 5, countedQty: 1, checkStatus: "pending", comment: "team note" }], []);
    res = await patchS({ discrepancyId: 3, action: "override-expected", itemId: 9, newStatus: "not_found" });
    expect(res.status).toBe(200);
    expect(updatesTo(counts)[0]).toMatchObject({ countedQty: 0, comment: "team note\nSupervisor override: not_found" });
  });
});
