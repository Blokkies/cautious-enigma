import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ payload: null as null | { id: number; type: string; name: string; eventId: number } }));
vi.mock("@/lib/token", () => ({ verifyToken: async () => state.payload }));

import { proxy } from "./proxy";

const req = (path: string, withToken = true) =>
  new NextRequest(`http://localhost${path}`, { headers: withToken ? { cookie: "stocktake-token=t" } : {} });

beforeEach(() => {
  state.payload = { id: 1, type: "admin", name: "Root", eventId: 0 };
});

describe("proxy: legacy admin redirects", () => {
  it("redirects an old URL with its event to the workspace", async () => {
    const res = await proxy(req("/admin/teams/assign?eventId=12"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/events/12/bins");
  });

  it("redirects before authentication (target is gated next)", async () => {
    const res = await proxy(req("/admin/settings", false));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/accounts");
  });
});

describe("proxy: /admin/** is admin-only", () => {
  it.each(["/admin", "/admin/events", "/admin/events/3/people", "/admin/events/3/setup/items", "/admin/help"])(
    "lets an admin through to %s",
    async (path) => {
      const res = await proxy(req(path));
      expect(res.headers.get("location")).toBeNull();
    }
  );

  it.each(["supervisor", "auditor", "team", "executive"])("sends a %s back to the login page", async (type) => {
    state.payload = { id: 2, type, name: "X", eventId: 1 };
    const res = await proxy(req("/admin/events/3"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("sends anonymous visitors to the login page", async () => {
    const res = await proxy(req("/admin/events", false));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });
});
