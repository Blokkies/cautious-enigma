import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Each db.select(...).from(...).where(...) resolves to the next queued result.
const { selectResults, transaction } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  transaction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(selectResults.shift() ?? []),
  };
  return { db: { select: () => chain, transaction } };
});

import { PUT } from "../activate/route";

const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-user-id": "1",
  "x-user-type": "admin",
  "x-user-name": "Root",
  "x-event-id": "0",
};

function reset(eventId = 5) {
  return PUT(
    new NextRequest("http://localhost/api/admin/activate", {
      method: "PUT",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ eventId, action: "reset" }),
    })
  );
}

beforeEach(() => {
  selectResults.length = 0;
  transaction.mockClear();
});

describe("PUT /api/admin/activate { action: 'reset' }", () => {
  it.each(["completed", "locked"])("is blocked with 403 on a %s event", async (status) => {
    selectResults.push([{ id: 1 }], [{ status }]); // admin exists, event status
    const res = await reset();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "This stocktake is completed or locked. Count data cannot be deleted.",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing event", async () => {
    selectResults.push([{ id: 1 }], []);
    const res = await reset();
    expect(res.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(["setup", "active"])("wipes operational data on a %s event", async (status) => {
    selectResults.push([{ id: 1 }], [{ status }]);
    const res = await reset();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a deleted admin's still-valid token with 401", async () => {
    selectResults.push([]);
    const res = await reset();
    expect(res.status).toBe(401);
    expect(transaction).not.toHaveBeenCalled();
  });
});
