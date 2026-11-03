import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { QueryRecord } from "./mock-db";

const state = vi.hoisted(() => ({
  respond: (() => []) as (rec: QueryRecord) => unknown,
  mock: null as null | ReturnType<typeof import("./mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("./mock-db");
  state.mock = createMockDb((rec) => state.respond(rec));
  return { db: state.mock.db };
});

import { ADMIN_HEADERS, callArgs, hasCall } from "./mock-db";
import { POST as eventsPOST, PUT as eventsPUT } from "../events/route";

const log = () => state.mock!.log;

function scenario(status = "setup", dates: { startDate?: string | null; endDate?: string | null } = {}) {
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      return [{ id: 5, name: "Old", status, warehouses: null, uploadId: null, startDate: dates.startDate ?? null, endDate: dates.endDate ?? null }];
    }
    if (rec.op === "update" && hasCall(rec, "returning")) return [{ id: 5 }];
    if (rec.op === "insert" && hasCall(rec, "returning")) return [{ id: 9 }];
    return [];
  };
}

const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/admin/events", { method, headers: ADMIN_HEADERS, body: JSON.stringify(body) });
const put = (body: object) => eventsPUT(req("PUT", { id: 5, ...body }));
const saved = () => {
  const update = log().find((r) => r.op === "update" && r.table === "stocktake_events");
  return update ? (callArgs(update, "set")![0] as Record<string, unknown>) : undefined;
};

beforeEach(() => {
  state.mock!.reset();
  scenario();
});

describe("PUT /api/admin/events details", () => {
  it.each(["setup", "active", "completed", "locked"])("edits details on a %s event", async (status) => {
    scenario(status);
    const res = await put({ name: "  New name ", location: "Durban", startDate: "2026-11-03", endDate: "2026-11-04" });
    expect(res.status).toBe(200);
    expect(saved()).toMatchObject({ name: "New name", location: "Durban", startDate: "2026-11-03", endDate: "2026-11-04" });
    expect(saved()).not.toHaveProperty("status");
  });

  it("leaves absent fields untouched", async () => {
    await put({ location: "" });
    const set = saved()!;
    expect(set.location).toBeNull();
    expect(set).not.toHaveProperty("name");
    expect(set).not.toHaveProperty("startDate");
  });

  it.each([
    [{ name: "" }],
    [{ name: "   " }],
    [{ name: "x".repeat(201) }],
    [{ startDate: "2026-02-30" }],
    [{ endDate: "not a date" }],
    [{ startDate: "2026-11-05", endDate: "2026-11-01" }],
  ])("rejects %j without writing", async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it("checks a new end date against the stored start date", async () => {
    scenario("active", { startDate: "2026-11-10" });
    expect((await put({ endDate: "2026-11-09" })).status).toBe(400);
    expect((await put({ endDate: "2026-11-10" })).status).toBe(200);
  });

  it("still applies a status change alongside details", async () => {
    scenario("active");
    const res = await put({ name: "Renamed", status: "completed" });
    expect(res.status).toBe(200);
    expect(saved()).toMatchObject({ name: "Renamed", status: "completed" });
  });
});

describe("POST /api/admin/events", () => {
  it("trims and stores details", async () => {
    const res = await eventsPOST(req("POST", { name: " Year end ", location: " ", startDate: "2026-11-03" }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(9);
    const insert = log().find((r) => r.op === "insert")!;
    expect(callArgs(insert, "values")![0]).toMatchObject({ name: "Year end", location: null, startDate: "2026-11-03", endDate: null, status: "setup" });
  });

  it.each([[{}], [{ name: "  " }], [{ name: "A", endDate: "x" }]])("rejects %j", async (body) => {
    expect((await eventsPOST(req("POST", body))).status).toBe(400);
    expect(log().some((r) => r.op === "insert")).toBe(false);
  });
});
