import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Each db.select(...).from(table).where(...) resolves to the next queued result.
const { selectResults, fromTables } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  fromTables: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const chain = {
    from: (table: unknown) => {
      fromTables.push(table);
      return chain;
    },
    where: () => Promise.resolve(selectResults.shift() ?? []),
  };
  return { db: { select: () => chain } };
});

import { POST } from "../login/route";
import { hashPin, verifyToken } from "@/lib/auth";
import { supervisors, teams, stocktakeEvents } from "@/lib/db/schema";

const EVENT = { id: 7, name: "Main", status: "active" };
let pinHash = "";
let ipCounter = 0;

beforeAll(async () => {
  pinHash = await hashPin("1234");
});

beforeEach(() => {
  selectResults.length = 0;
  fromTables.length = 0;
});

function login(body: Record<string, unknown>) {
  // Unique IP per request so the in-memory rate limiter never interferes.
  ipCounter++;
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${ipCounter}` },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/auth/login", () => {
  it("rejects missing fields with 400", async () => {
    const res = await login({ type: "team", id: 1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing required fields" });
  });

  it("returns 400 when no event resolves", async () => {
    selectResults.push([]);
    const res = await login({ type: "team", id: 1, pin: "1234", eventId: 99 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No active stocktake event" });
  });

  it("rejects an unknown login type with 400 after resolving the event", async () => {
    selectResults.push([EVENT]);
    const res = await login({ type: "admin", id: 1, pin: "1234", eventId: 7 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid login type" });
  });

  it.each([
    ["team", teams],
    ["supervisor", supervisors],
    ["auditor", supervisors],
  ] as const)("%s: success sets the session cookie and returns the user", async (type, table) => {
    selectResults.push([EVENT], [{ id: 3, name: "Alpha", pinHash }]);
    const res = await login({ type, id: "3", pin: "1234", eventId: 7 });

    expect(res.status).toBe(200);
    const expectedUser = { id: 3, type, name: "Alpha", eventId: 7, eventName: "Main", eventStatus: "active" };
    expect(await res.json()).toEqual({ success: true, user: expectedUser });
    expect(fromTables).toEqual([stocktakeEvents, table]);

    const cookie = res.cookies.get("stocktake-token");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(60 * 60 * 72);
    expect(await verifyToken(cookie!.value)).toMatchObject(expectedUser);
  });

  it.each(["team", "supervisor", "auditor"])("%s: unknown account is 401", async (type) => {
    selectResults.push([EVENT], []);
    const res = await login({ type, id: 3, pin: "1234", eventId: 7 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
    expect(res.cookies.get("stocktake-token")).toBeUndefined();
  });

  it.each(["team", "supervisor", "auditor"])("%s: wrong PIN is 401", async (type) => {
    selectResults.push([EVENT], [{ id: 3, name: "Alpha", pinHash }]);
    const res = await login({ type, id: 3, pin: "9999", eventId: 7 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
  });

  it("falls back to the active event when no eventId is given", async () => {
    selectResults.push([EVENT], [{ id: 3, name: "Alpha", pinHash }]);
    const res = await login({ type: "team", id: 3, pin: "1234" });
    expect(res.status).toBe(200);
  });

  it("returns 429 once the per-IP limit is exceeded", async () => {
    const req = () =>
      POST(
        new NextRequest("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
          body: JSON.stringify({}),
        })
      );
    for (let i = 0; i < 10; i++) expect((await req()).status).toBe(400);
    const res = await req();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
