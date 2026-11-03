import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import type { QueryRecord } from "./mock-db";

const state = vi.hoisted(() => ({
  /** Admin rows as stored. */
  admins: [] as { id: number; passwordHash: string }[],
  mock: null as null | ReturnType<typeof import("./mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("./mock-db");
  state.mock = createMockDb((rec: QueryRecord) => {
    if (rec.op === "select" && rec.table === "admins") {
      // principalExists (outside the tx) only needs the caller (id 1) to exist
      if (!rec.inTx && rec.fields.join() === "id") return [{ id: 1 }];
      return state.admins;
    }
    if (rec.op === "insert" && rec.table === "admins") return [{ id: 99 }];
    return [];
  });
  return { db: state.mock.db };
});

import { ADMIN_HEADERS, hasCall } from "./mock-db";
import { DELETE, POST } from "../admins/route";

const log = () => state.mock!.log;
const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/admin/admins", { method, headers: ADMIN_HEADERS, body: JSON.stringify(body) });

let hashA = "";
beforeAll(async () => {
  hashA = await bcrypt.hash("existing-pass", 4);
});

beforeEach(() => {
  state.mock!.reset();
  state.admins = [
    { id: 1, passwordHash: hashA },
    { id: 2, passwordHash: hashA },
  ];
});

describe("DELETE /api/admin/admins", () => {
  it.each([1, "1", " 1 "])("refuses self-delete for id %j", async (id) => {
    const res = await DELETE(req("DELETE", { id }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot delete yourself" });
    expect(log().some((r) => r.op === "delete")).toBe(false);
  });

  it.each(["abc", 1.5, -2, {}, true])("rejects invalid id %j with 400", async (id) => {
    const res = await DELETE(req("DELETE", { id }));
    expect(res.status).toBe(400);
    expect(log().some((r) => r.op === "delete")).toBe(false);
  });

  it("returns 404 for an id that does not exist", async () => {
    const res = await DELETE(req("DELETE", { id: 42 }));
    expect(res.status).toBe(404);
    expect(log().some((r) => r.op === "delete")).toBe(false);
  });

  it("refuses to delete the last admin", async () => {
    state.admins = [{ id: 2, passwordHash: hashA }];
    const res = await DELETE(req("DELETE", { id: 2 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot delete the last admin" });
    expect(log().some((r) => r.op === "delete")).toBe(false);
  });

  it("locks the admin rows (FOR UPDATE) inside the transaction before deleting", async () => {
    const res = await DELETE(req("DELETE", { id: "2" }));
    expect(res.status).toBe(200);
    const lockRead = log().find((r) => r.op === "select" && r.table === "admins" && r.inTx)!;
    expect(hasCall(lockRead, "for")).toBe(true);
    expect(lockRead.calls.find(([m]) => m === "for")![1]).toEqual(["update"]);
    const del = log().find((r) => r.op === "delete" && r.table === "admins")!;
    expect(del.inTx).toBe(true);
    expect(log().indexOf(lockRead)).toBeLessThan(log().indexOf(del));
  });
});

describe("POST /api/admin/admins", () => {
  it("rejects a password another admin already uses with 409", async () => {
    const res = await POST(req("POST", { name: "New", password: "existing-pass" }));
    expect(res.status).toBe(409);
    expect(log().some((r) => r.op === "insert")).toBe(false);
  });

  it("creates the admin under an advisory lock when the password is unique", async () => {
    const res = await POST(req("POST", { name: "New", password: "brand-new-pass" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, admin: { id: 99, name: "New" } });
    const lock = log().find((r) => r.op === "execute")!;
    expect(lock.inTx).toBe(true);
    expect(lock.text).toContain("pg_advisory_xact_lock");
    const insert = log().find((r) => r.op === "insert")!;
    expect(insert.inTx).toBe(true);
  });

  it("rejects a non-string password with 400", async () => {
    const res = await POST(req("POST", { name: "New", password: 12345678 }));
    expect(res.status).toBe(400);
  });
});
