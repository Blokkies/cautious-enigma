import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Record the event id each query filters on: eq(teams.eventId, X) -> X.
const { whereArgs, currentUser } = vi.hoisted(() => ({
  whereArgs: [] as unknown[],
  currentUser: { value: null as null | { id: number; type: string; name: string; eventId: number } },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (_col: unknown, val: unknown) => ({ eqValue: val }) };
});

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: (arg: { eqValue: unknown }) => {
      whereArgs.push(arg.eqValue);
      return Promise.resolve([]);
    },
  };
  return { db: { select: () => chain } };
});

vi.mock("@/lib/api-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-auth")>();
  return { ...actual, requireUser: async () => ({ user: currentUser.value }) };
});

import { GET } from "../teams/route";

beforeEach(() => {
  whereArgs.length = 0;
});

function get(query = "") {
  return GET(new NextRequest(`http://localhost/api/supervisor/teams${query}`));
}

describe("GET /api/supervisor/teams event scoping", () => {
  it("uses ?eventId for executives (token eventId 0)", async () => {
    currentUser.value = { id: 1, type: "executive", name: "E", eventId: 0 };
    const res = await get("?eventId=5");
    expect(res.status).toBe(200);
    expect(whereArgs).toEqual([5]);
  });

  it("rejects executives without ?eventId instead of querying event 0", async () => {
    currentUser.value = { id: 1, type: "executive", name: "E", eventId: 0 };
    const res = await get();
    expect(res.status).toBe(400);
    expect(whereArgs).toEqual([]);
  });

  it("pins supervisors to their token event, ignoring ?eventId", async () => {
    currentUser.value = { id: 2, type: "supervisor", name: "S", eventId: 3 };
    const res = await get("?eventId=9");
    expect(res.status).toBe(200);
    expect(whereArgs).toEqual([3]);
  });
});
