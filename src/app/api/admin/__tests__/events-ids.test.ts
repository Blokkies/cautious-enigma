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
import { DELETE as eventsDELETE, PUT as eventsPUT } from "../events/route";
import { DELETE as activateDELETE, GET as activateGET, POST as activatePOST, PUT as activatePUT } from "../activate/route";
import { GET as exportGET } from "../export/route";

const log = () => state.mock!.log;

interface Scenario {
  status?: string;
  presentWarehouses?: string[];
  supervisors?: number;
}

function scenario(s: Scenario = {}) {
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      return [{ id: 5, name: "E", status: s.status ?? "setup", warehouses: null, uploadId: null }];
    }
    if (rec.op === "select" && rec.table === "items" && hasCall(rec, "groupBy")) {
      return (s.presentWarehouses ?? ["JHB", "CPT"]).map((warehouse) => ({ warehouse }));
    }
    if (rec.op === "select" && rec.table === "supervisors") return [{ count: s.supervisors ?? 1 }];
    if (rec.op === "select" && (rec.table === "items" || rec.table === "teams")) return [{ count: 3 }];
    if (rec.op === "select" && rec.table === "counts") return [{ count: 0 }];
    if (rec.op === "update" && hasCall(rec, "returning")) return [{ id: 5 }];
    return [];
  };
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: ADMIN_HEADERS, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(url, { headers: ADMIN_HEADERS });

beforeEach(() => {
  state.mock!.reset();
  scenario();
});

describe("PUT /api/admin/events warehouses", () => {
  const put = (body: unknown) => eventsPUT(json("http://localhost/api/admin/events", "PUT", { id: 5, ...(body as object) }));
  const saved = () => {
    const update = log().find((r) => r.op === "update" && r.table === "stocktake_events");
    return update ? (callArgs(update, "set")![0] as { warehouses?: string | null }).warehouses : undefined;
  };

  it("saves a valid selection during setup", async () => {
    const res = await put({ warehouses: ["JHB", "JHB"] });
    expect(res.status).toBe(200);
    expect(saved()).toBe(JSON.stringify(["JHB"]));
  });

  it("allows null (all warehouses)", async () => {
    expect((await put({ warehouses: null })).status).toBe(200);
    expect(saved()).toBeNull();
  });

  it.each(["active", "completed", "locked"])("rejects changes on a %s event", async (status) => {
    scenario({ status });
    const res = await put({ warehouses: ["JHB"] });
    expect(res.status).toBe(409);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it.each([[[]], ["JHB"], [[1]], [[""]], [{ a: 1 }]])("rejects malformed warehouses %j", async (warehouses) => {
    const res = await put({ warehouses });
    expect(res.status).toBe(400);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it("rejects warehouses not present in the event's items", async () => {
    scenario({ presentWarehouses: ["JHB"] });
    const res = await put({ warehouses: ["JHB", "Nope"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Nope");
  });
});

describe("non-numeric ids answer 400", () => {
  it("events PUT / DELETE", async () => {
    expect((await eventsPUT(json("http://localhost/api/admin/events", "PUT", { id: "abc", status: "active" }))).status).toBe(400);
    expect((await eventsDELETE(json("http://localhost/api/admin/events", "DELETE", { id: "abc" }))).status).toBe(400);
    expect((await eventsDELETE(json("http://localhost/api/admin/events", "DELETE", { id: 1.5 }))).status).toBe(400);
  });

  it("activate GET / POST / PUT / DELETE", async () => {
    expect((await activateGET(get("http://localhost/api/admin/activate?eventId=abc"))).status).toBe(400);
    const url = "http://localhost/api/admin/activate";
    expect((await activatePOST(json(url, "POST", { eventId: "x" }))).status).toBe(400);
    expect((await activatePUT(json(url, "PUT", { eventId: "x", action: "reset" }))).status).toBe(400);
    expect((await activateDELETE(json(url, "DELETE", { eventId: null }))).status).toBe(400);
    expect(log().some((r) => r.op !== "select")).toBe(false);
  });

  it("admin export", async () => {
    expect((await exportGET(get("http://localhost/api/admin/export?eventId=abc"))).status).toBe(400);
    expect((await exportGET(get("http://localhost/api/admin/export?eventId=-1"))).status).toBe(400);
  });
});

describe("activation requires a supervisor", () => {
  it("POST /api/admin/activate refuses an event without supervisors", async () => {
    scenario({ supervisors: 0 });
    const res = await activatePOST(json("http://localhost/api/admin/activate", "POST", { eventId: 5 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no supervisors/);
    expect(body.readiness.supervisorCount).toBe(0);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it("GET reports the blocker", async () => {
    scenario({ supervisors: 0 });
    const body = await (await activateGET(get("http://localhost/api/admin/activate?eventId=5"))).json();
    expect(body.hasSupervisors).toBe(false);
    expect(body.blocker).toMatch(/no supervisors/);
  });
});
