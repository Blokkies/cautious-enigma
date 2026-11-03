import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { QueryRecord } from "./mock-db";

const state = vi.hoisted(() => ({
  teamEventId: 5,
  mock: null as null | ReturnType<typeof import("./mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("./mock-db");
  state.mock = createMockDb((rec: QueryRecord) => {
    if (rec.op === "select" && rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") return [{ status: "active", warehouses: null }];
    if (rec.op === "select" && rec.table === "supervisors") {
      if (rec.fields.join() === "id") return [{ id: 10 }]; // principalExists
      if (rec.fields.includes("pinPlain")) {
        return [
          { id: 10, name: "Sam", role: "supervisor", pinPlain: "1111" },
          { id: 11, name: "Ann", role: "auditor", pinPlain: "2222" },
        ];
      }
      return [{ eventId: 5 }];
    }
    if (rec.op === "select" && rec.table === "teams") {
      if (rec.fields.length === 0) return [{ id: 3, eventId: 5, name: "Alpha", members: null, pinHash: "h", pinPlain: "4321" }];
      return [{ eventId: state.teamEventId }];
    }
    if (rec.op === "select" && rec.table === "verification_assignments") return [{ count: 0 }];
    if (rec.op === "insert") return [{ id: 77 }];
    return [];
  });
  return { db: state.mock.db };
});

import { ADMIN_HEADERS, callArgs } from "./mock-db";
import { DELETE, GET, POST, PUT } from "../teams/route";

const SUPERVISOR_HEADERS = {
  "content-type": "application/json",
  "x-user-id": "10",
  "x-user-type": "supervisor",
  "x-user-name": "Sam",
  "x-event-id": "5",
};

const log = () => state.mock!.log;
const URL_ = "http://localhost/api/admin/teams";
const req = (method: string, body: unknown, headers: Record<string, string> = ADMIN_HEADERS) =>
  new NextRequest(URL_, { method, headers, body: JSON.stringify(body) });
const inserts = () => log().filter((r) => r.op === "insert");

beforeEach(() => {
  state.mock!.reset();
  state.teamEventId = 5;
});

describe("POST /api/admin/teams", () => {
  it("accepts a numeric PIN by coercing it to a string", async () => {
    const res = await POST(req("POST", { eventId: 5, type: "team", name: "Alpha", pin: 1234 }));
    expect(res.status).toBe(200);
    const values = callArgs(inserts()[0], "values")![0] as { pinPlain: string; pinHash: string };
    expect(values.pinPlain).toBe("1234");
    expect(typeof values.pinHash).toBe("string");
  });

  it.each(["123", "12ab", "1234567", 123, { a: 1 }])("rejects PIN %j with 400", async (pin) => {
    const res = await POST(req("POST", { eventId: 5, type: "team", name: "Alpha", pin }));
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  it.each(["admin", "executive", "Team"])("rejects unknown type %j with 400", async (type) => {
    const res = await POST(req("POST", { eventId: 5, type, name: "X", pin: "1234" }));
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  it("rejects an arbitrary role with 400", async () => {
    const res = await POST(req("POST", { eventId: 5, type: "supervisor", role: "admin", name: "X", pin: "1234" }));
    expect(res.status).toBe(400);
    expect(inserts()).toHaveLength(0);
  });

  it("lets an admin create a supervisor", async () => {
    const res = await POST(req("POST", { eventId: 5, type: "supervisor", name: "X", pin: "1234" }));
    expect(res.status).toBe(200);
    expect(inserts()[0].table).toBe("supervisors");
  });

  it.each(["supervisor", "auditor"])("forbids a supervisor from creating a %s", async (type) => {
    const res = await POST(req("POST", { type, name: "X", pin: "1234" }, SUPERVISOR_HEADERS));
    expect(res.status).toBe(403);
    expect(inserts()).toHaveLength(0);
  });

  it("lets a supervisor create a team in their own event, ignoring a body eventId", async () => {
    const res = await POST(req("POST", { eventId: 999, type: "team", name: "X", pin: "1234" }, SUPERVISOR_HEADERS));
    expect(res.status).toBe(200);
    const values = callArgs(inserts()[0], "values")![0] as { eventId: number };
    expect(inserts()[0].table).toBe("teams");
    expect(values.eventId).toBe(5);
  });
});

describe("PUT /api/admin/teams", () => {
  it("returns 400 for a non-numeric id", async () => {
    const res = await PUT(req("PUT", { id: "abc", name: "A" }));
    expect(res.status).toBe(400);
    expect(log().some((r) => r.table === "teams")).toBe(false);
  });

  it("accepts a numeric PIN", async () => {
    const res = await PUT(req("PUT", { id: 3, name: "A", pin: 5678 }));
    expect(res.status).toBe(200);
    const update = log().find((r) => r.op === "update" && r.table === "teams")!;
    expect((callArgs(update, "set")![0] as { pinPlain: string }).pinPlain).toBe("5678");
  });

  it("rejects an invalid PIN with 400 instead of silently ignoring it", async () => {
    const res = await PUT(req("PUT", { id: 3, name: "A", pin: "12" }));
    expect(res.status).toBe(400);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it("keeps the PIN when none is given", async () => {
    const res = await PUT(req("PUT", { id: 3, name: "A" }));
    expect(res.status).toBe(200);
    const update = log().find((r) => r.op === "update" && r.table === "teams")!;
    expect(callArgs(update, "set")![0]).not.toHaveProperty("pinHash");
  });

  it("forbids a supervisor from editing another event's team", async () => {
    state.teamEventId = 6;
    const res = await PUT(req("PUT", { id: 3, name: "A" }, SUPERVISOR_HEADERS));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/teams", () => {
  it.each([{ id: "abc" }, { id: "abc", type: "supervisor" }, { id: null }])("returns 400 for %j", async (body) => {
    const res = await DELETE(req("DELETE", body));
    expect(res.status).toBe(400);
    expect(state.mock!.transactionCount()).toBe(0);
  });

  it("returns 400 for an unknown type", async () => {
    const res = await DELETE(req("DELETE", { id: 3, type: "admin" }));
    expect(res.status).toBe(400);
  });

  it.each(["supervisor", "auditor"])("forbids a supervisor from deleting a %s", async (type) => {
    const res = await DELETE(req("DELETE", { id: 11, type }, SUPERVISOR_HEADERS));
    expect(res.status).toBe(403);
    expect(state.mock!.transactionCount()).toBe(0);
  });

  it("lets a supervisor delete a team in their event, with a numeric id in the SQL", async () => {
    const res = await DELETE(req("DELETE", { id: "3" }, SUPERVISOR_HEADERS));
    expect(res.status).toBe(200);
    const del = log().find((r) => r.op === "delete" && r.table === "teams")!;
    expect(del.inTx).toBe(true);
  });
});

describe("GET /api/admin/teams", () => {
  it("never sends supervisor/auditor PINs to a supervisor (team PINs still visible)", async () => {
    const res = await GET(new NextRequest(`${URL_}?eventId=5`, { headers: SUPERVISOR_HEADERS }));
    const body = await res.json();
    expect(body.supervisors.map((s: { pinPlain?: string }) => s.pinPlain)).toEqual([undefined, undefined]);
    expect(body.teams[0].pinPlain).toBe("4321");
    expect(body.teams[0].pinHash).toBeUndefined();
  });

  it("sends supervisor/auditor PINs to an admin", async () => {
    const res = await GET(new NextRequest(`${URL_}?eventId=5`, { headers: ADMIN_HEADERS }));
    const body = await res.json();
    expect(body.supervisors.map((s: { pinPlain?: string }) => s.pinPlain)).toEqual(["1111", "2222"]);
  });
});
