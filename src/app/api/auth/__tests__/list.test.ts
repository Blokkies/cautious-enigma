import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { QueryRecord } from "../../admin/__tests__/mock-db";

const state = vi.hoisted(() => ({
  event: null as null | { id: number; status: string },
  mock: null as null | ReturnType<typeof import("../../admin/__tests__/mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("../../admin/__tests__/mock-db");
  state.mock = createMockDb((rec: QueryRecord) => {
    if (rec.op === "select" && rec.table === "stocktake_events") return state.event ? [state.event] : [];
    if (rec.op === "select" && rec.table === "teams") return [{ id: 1, name: "Alpha" }];
    if (rec.op === "select" && rec.table === "supervisors") return [{ id: 2, name: "Sam" }];
    return [];
  });
  return { db: state.mock.db };
});

import { GET } from "../list/route";

const list = (query: string) => GET(new NextRequest(`http://localhost/api/auth/list?${query}`));
const log = () => state.mock!.log;

beforeEach(() => {
  state.mock!.reset();
  state.event = { id: 7, status: "active" };
});

describe("GET /api/auth/list", () => {
  it("returns only id and name for teams (no members)", async () => {
    const res = await list("type=team&eventId=7");
    expect(await res.json()).toEqual({ items: [{ id: 1, name: "Alpha" }] });
    const teamSelect = log().find((r) => r.table === "teams")!;
    expect(teamSelect.fields).toEqual(["id", "name"]);
  });

  it.each(["completed", "locked"])("lists no teams for a %s event", async (status) => {
    state.event = { id: 7, status };
    const res = await list("type=team&eventId=7");
    expect(await res.json()).toEqual({ items: [] });
    expect(log().some((r) => r.table === "teams")).toBe(false);
  });

  it.each(["supervisor", "auditor"])("lists %s accounts for a completed event", async (type) => {
    state.event = { id: 7, status: "completed" };
    const res = await list(`type=${type}&eventId=7`);
    expect(await res.json()).toEqual({ items: [{ id: 2, name: "Sam" }] });
  });

  it.each(["supervisor", "auditor"])("lists no %s accounts for a locked event", async (type) => {
    state.event = { id: 7, status: "locked" };
    const res = await list(`type=${type}&eventId=7`);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("returns no items for an unknown event", async () => {
    state.event = null;
    expect(await (await list("type=team&eventId=99")).json()).toEqual({ items: [] });
  });

  it("returns 400 for a non-numeric eventId", async () => {
    const res = await list("type=team&eventId=abc");
    expect(res.status).toBe(400);
    expect(log()).toHaveLength(0);
  });

  it("returns no items for an unknown type", async () => {
    expect(await (await list("type=admin&eventId=7")).json()).toEqual({ items: [] });
    expect(log()).toHaveLength(0);
  });
});
