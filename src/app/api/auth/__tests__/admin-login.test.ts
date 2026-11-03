import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import type { QueryRecord } from "../../admin/__tests__/mock-db";

const state = vi.hoisted(() => ({
  admins: [] as { id: number; name: string; passwordHash: string }[],
  mock: null as null | ReturnType<typeof import("../../admin/__tests__/mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("../../admin/__tests__/mock-db");
  state.mock = createMockDb((rec: QueryRecord) => {
    if (rec.op === "select" && rec.table === "admins") return state.admins;
    if (rec.op === "insert" && rec.table === "admins") return [{ id: 1 }];
    return [];
  });
  return { db: state.mock.db };
});

import { POST } from "../admin-login/route";

let ipCounter = 0;
function login(password: unknown, ip = `10.1.0.${++ipCounter}`) {
  return POST(
    new NextRequest("http://localhost/api/auth/admin-login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ password }),
    })
  );
}

beforeEach(() => {
  state.admins = [];
  state.mock!.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/auth/admin-login bootstrap (no admins yet)", () => {
  it("production without ADMIN_PASSWORD: the dev default is refused and bootstrap is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", "");
    const res = await login("admin2026");
    expect(res.status).toBe(503);
    expect(state.mock!.log.some((r) => r.op === "insert")).toBe(false);
  });

  it("production with ADMIN_PASSWORD: only that password creates the first admin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", "s3cret-prod");
    expect((await login("admin2026")).status).toBe(401);
    const res = await login("s3cret-prod");
    expect(res.status).toBe(200);
    expect(state.mock!.log.some((r) => r.op === "insert" && r.table === "admins")).toBe(true);
  });

  it("development without ADMIN_PASSWORD falls back to the dev default", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect((await login("admin2026")).status).toBe(200);
  });
});

describe("POST /api/auth/admin-login with existing admins", () => {
  it("production without ADMIN_PASSWORD still lets existing admins log in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", "");
    state.admins = [{ id: 4, name: "Ops", passwordHash: await bcrypt.hash("ops-pass", 4) }];
    const res = await login("ops-pass");
    expect(res.status).toBe(200);
    expect((await res.json()).user).toEqual({ id: 4, type: "admin", name: "Ops" });
  });

  it("rejects a non-string password with 400", async () => {
    expect((await login(12345678)).status).toBe(400);
  });

  it("rate-limits per X-Real-Ip even when X-Forwarded-For varies", async () => {
    state.admins = [{ id: 4, name: "Ops", passwordHash: await bcrypt.hash("ops-pass", 4) }];
    const attempt = (i: number) =>
      POST(
        new NextRequest("http://localhost/api/auth/admin-login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": "10.2.2.2", "x-forwarded-for": `9.9.9.${i}` },
          body: JSON.stringify({ password: "wrong" }),
        })
      );
    for (let i = 0; i < 5; i++) expect((await attempt(i)).status).toBe(401);
    expect((await attempt(99)).status).toBe(429);
  });
});
