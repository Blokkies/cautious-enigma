import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { QueryRecord } from "./mock-db";

const state = vi.hoisted(() => ({
  upload: null as null | { fileData: string; mimeType: string | null; filename: string | null },
  mock: null as null | ReturnType<typeof import("./mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("./mock-db");
  state.mock = createMockDb((rec: QueryRecord) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.table === "uploads") return state.upload ? [state.upload] : [];
    return [];
  });
  return { db: state.mock.db };
});

import { ADMIN_HEADERS } from "./mock-db";
import { GET } from "../uploads/[id]/download/route";

const download = (id: string) =>
  GET(new NextRequest(`http://localhost/api/admin/uploads/${id}/download`, { headers: ADMIN_HEADERS }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  state.mock!.reset();
  state.upload = { fileData: Buffer.from("hello").toString("base64"), mimeType: "text/csv", filename: "stock.csv" };
});

describe("GET /api/admin/uploads/[id]/download", () => {
  it.each(["abc", "1.5", "-1", "0"])("returns 400 for id %j without querying uploads", async (id) => {
    const res = await download(id);
    expect(res.status).toBe(400);
    expect(state.mock!.log.some((r) => r.table === "uploads")).toBe(false);
  });

  it("returns 404 for an unknown upload", async () => {
    state.upload = null;
    expect((await download("5")).status).toBe(404);
  });

  it("serves the file as an attachment with nosniff", async () => {
    const res = await download("5");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="stock.csv"/);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(await res.text()).toBe("hello");
  });

  it("serves a malformed stored mime type as application/octet-stream", async () => {
    state.upload = { ...state.upload!, mimeType: "text/html; x\"y" };
    const res = await download("5");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("neutralizes quotes in the filename", async () => {
    state.upload = { ...state.upload!, filename: 'a"b.xlsx' };
    const res = await download("5");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="a_b.xlsx"/);
  });
});
