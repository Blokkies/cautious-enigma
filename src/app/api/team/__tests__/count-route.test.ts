import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { fake, eventState } = vi.hoisted(() => ({
  fake: { current: null as null | ReturnType<typeof import("./fake-db").createFakeDb> },
  eventState: { lockError: null as string | null },
}));

// Plain condition objects evaluated by the fake db (inlined: importing
// ./fake-db here would deadlock, it imports drizzle-orm itself).
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
  return { db: fake.current.db };
});

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => ({ user: { id: 10, type: "team", name: "T", eventId: 1 } }),
  checkEventActive: async () => eventState.lockError,
}));

import { POST, PUT } from "../count/route";
import { counts, items, verificationAssignments } from "@/lib/db/schema";

const TEAM = 10;
const EVENT = 1;
const db = () => fake.current!;

function req(method: "POST" | "PUT", body: unknown) {
  return new NextRequest("http://localhost/api/team/count", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedItem(id = 1000, onHand = 5) {
  return db().seed(items, { id, eventId: EVENT, teamId: TEAM, itemCode: `I${id}`, onHand, avgCost: 1 });
}

function seedCount(values: Record<string, unknown> = {}) {
  return db().seed(counts, {
    id: 2000,
    itemId: 1000,
    teamId: TEAM,
    eventId: EVENT,
    countedQty: 3,
    variance: -2,
    countedAt: "2026-01-01T12:00:00.000Z",
    clientId: "stored",
    ...values,
  });
}

const initialCounts = () => db().rows(counts).filter((c) => c.countType === "initial");

beforeEach(() => {
  db().reset();
  eventState.lockError = null;
});

describe("team write gate", () => {
  it("returns a retryable 423 EVENT_NOT_ACTIVE when the event is not active", async () => {
    eventState.lockError = "This stocktake has not been activated yet.";
    for (const res of [await POST(req("POST", {})), await PUT(req("PUT", { counts: [] }))]) {
      expect(res.status).toBe(423);
      expect(await res.json()).toEqual({
        error: "This stocktake has not been activated yet.",
        code: "EVENT_NOT_ACTIVE",
      });
    }
  });

  it("keeps a definitive 403 for a missing event", async () => {
    eventState.lockError = "Event not found";
    expect((await POST(req("POST", {}))).status).toBe(403);
  });
});

describe("POST /api/team/count", () => {
  it("acknowledges a replay of an applied count even while the item is under verification", async () => {
    seedItem();
    seedCount({ clientId: "abc" });
    db().seed(verificationAssignments, { id: 3000, countId: 2000, itemId: 1000, eventId: EVENT, assignedTeamId: 99, assignedBy: 1, status: "pending" });

    const res = await POST(req("POST", { itemId: 1000, countedQty: 3, clientId: "abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, deduplicated: true });
  });

  it.each(["pending", "completed"])("blocks a new count while an assignment is %s", async (status) => {
    seedItem();
    seedCount();
    db().seed(verificationAssignments, { id: 3000, countId: 2000, itemId: 1000, eventId: EVENT, assignedTeamId: 99, assignedBy: 1, status });

    const res = await POST(req("POST", { itemId: 1000, countedQty: 9, clientId: "new" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This item has a pending verification and cannot be edited" });
    expect(initialCounts()[0].countedQty).toBe(3);
  });

  it("allows edits once the supervisor has decided (accepted assignment)", async () => {
    seedItem();
    seedCount();
    db().seed(verificationAssignments, { id: 3000, countId: 2000, itemId: 1000, eventId: EVENT, assignedTeamId: 99, assignedBy: 1, status: "accepted" });
    expect((await POST(req("POST", { itemId: 1000, countedQty: 9, clientId: "new" }))).status).toBe(200);
  });

  it("applies a later correction from a device with a slow clock (last received wins)", async () => {
    seedItem();
    seedCount({ countedAt: "2026-01-01T12:00:00.000Z" });

    const res = await POST(req("POST", {
      itemId: 1000, countedQty: 7, clientId: "correction", countedAt: "2026-01-01T09:00:00.000Z",
    }));
    const body = await res.json();
    expect(body.deduplicated).toBeUndefined();
    expect(initialCounts()).toHaveLength(1);
    expect(initialCounts()[0]).toMatchObject({ countedQty: 7, variance: 2, clientId: "correction" });
  });

  it("deduplicates an identical submission by clientId only", async () => {
    seedItem();
    seedCount({ clientId: "same", countedQty: 3 });
    const res = await POST(req("POST", { itemId: 1000, countedQty: 99, clientId: "same" }));
    expect(await res.json()).toMatchObject({ deduplicated: true });
    expect(initialCounts()[0].countedQty).toBe(3);
  });

  it("clamps a future countedAt to server time", async () => {
    seedItem();
    const before = Date.now();
    await POST(req("POST", { itemId: 1000, countedQty: 5, clientId: "f", countedAt: "2099-01-01T00:00:00.000Z" }));
    const stored = Date.parse(initialCounts()[0].countedAt as string);
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it("resets a reviewed comment when the comment text changes, but not otherwise", async () => {
    seedItem();
    seedCount({ comment: "old", commentStatus: "reviewed" });

    await POST(req("POST", { itemId: 1000, countedQty: 4, clientId: "keep" })); // comment undefined = keep
    expect(initialCounts()[0]).toMatchObject({ comment: "old", commentStatus: "reviewed" });

    await POST(req("POST", { itemId: 1000, countedQty: 4, clientId: "same-text", comment: "old" }));
    expect(initialCounts()[0].commentStatus).toBe("reviewed");

    await POST(req("POST", { itemId: 1000, countedQty: 4, clientId: "edit", comment: "new" }));
    expect(initialCounts()[0]).toMatchObject({ comment: "new", commentStatus: null });
  });
});

describe("PUT /api/team/count (batch sync)", () => {
  it("applies the batch's last entry per item in client order, regardless of countedAt", async () => {
    seedItem();
    seedCount({ countedAt: "2026-01-01T23:00:00.000Z" });

    const res = await PUT(req("PUT", {
      counts: [
        { itemId: 1000, countedQty: 1, clientId: "first", countedAt: "2026-01-01T10:00:00.000Z" },
        { itemId: 1000, countedQty: 8, clientId: "second", countedAt: "2026-01-01T08:00:00.000Z" },
      ],
    }));
    const body = await res.json();
    expect(body.results).toEqual([
      { itemId: 1000, deduplicated: true },
      { itemId: 1000, success: true },
    ]);
    expect(initialCounts()[0]).toMatchObject({ countedQty: 8, clientId: "second" });
  });

  it("overwrites a stored count with a newer-arriving one even if its countedAt is older", async () => {
    seedItem();
    seedCount({ countedAt: "2026-01-01T23:00:00.000Z", comment: "c", commentStatus: "reviewed" });
    const res = await PUT(req("PUT", {
      counts: [{ itemId: 1000, countedQty: 6, clientId: "late", countedAt: "2026-01-01T01:00:00.000Z", comment: "edited" }],
    }));
    expect((await res.json()).results).toEqual([{ itemId: 1000, success: true }]);
    expect(initialCounts()[0]).toMatchObject({ countedQty: 6, comment: "edited", commentStatus: null });
  });

  it("deduplicates an already-applied clientId", async () => {
    seedItem();
    seedCount({ clientId: "done" });
    const res = await PUT(req("PUT", { counts: [{ itemId: 1000, countedQty: 50, clientId: "done" }] }));
    expect((await res.json()).results).toEqual([{ itemId: 1000, deduplicated: true }]);
    expect(initialCounts()[0].countedQty).toBe(3);
  });

  it.each(["pending", "completed"])("rejects normal counts while an assignment is %s", async (status) => {
    seedItem();
    seedCount();
    db().seed(verificationAssignments, { id: 3000, countId: 2000, itemId: 1000, eventId: EVENT, assignedTeamId: 99, assignedBy: 1, status });
    const res = await PUT(req("PUT", { counts: [{ itemId: 1000, countedQty: 50, clientId: "x" }] }));
    expect((await res.json()).results).toEqual([{ itemId: 1000, error: "Pending verification" }]);
  });

  it("reports a verification replay applied concurrently (while waiting for the lock) as deduplicated", async () => {
    seedItem();
    seedCount();
    const va = db().seed(verificationAssignments, {
      id: 3000, countId: 2000, itemId: 1000, eventId: EVENT, assignedTeamId: TEAM, assignedBy: 1, status: "pending",
    });
    // A concurrent single POST with the same clientId commits just before our lock is granted
    db().onLock(verificationAssignments, () => {
      if (va.status !== "pending") return;
      va.status = "completed";
      db().seed(counts, {
        id: 2001, itemId: 1000, teamId: TEAM, eventId: EVENT, countedQty: 4,
        clientId: "v-1", countType: "verification", verificationId: 3000,
      });
    });

    const res = await PUT(req("PUT", {
      counts: [],
      verificationCounts: [{ verificationId: 3000, itemId: 1000, countedQty: 4, clientId: "v-1" }],
    }));
    expect((await res.json()).verificationResults).toEqual([{ verificationId: 3000, deduplicated: true }]);
  });
});
