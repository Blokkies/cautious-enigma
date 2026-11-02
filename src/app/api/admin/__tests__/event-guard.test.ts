import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectResults } = vi.hoisted(() => ({ selectResults: [] as unknown[][] }));

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(selectResults.shift() ?? []),
  };
  return { db: { select: () => chain } };
});

import { checkEventWritable } from "../event-guard";

const CLOSED_MSG = "This stocktake is completed or locked. No further changes are allowed.";
const DELETE_MSG = "This stocktake is completed or locked. Count data cannot be deleted.";

beforeEach(() => {
  selectResults.length = 0;
});

async function check(status: string | null, userType: string, deletesCounts?: boolean) {
  selectResults.push(status === null ? [] : [{ status }]);
  return checkEventWritable(1, userType, deletesCounts);
}

describe("checkEventWritable", () => {
  it("reports a missing event", async () => {
    expect(await check(null, "admin")).toBe("Event not found");
  });

  it.each([
    // status, userType, deletesCounts, expected
    ["setup", "admin", false, null],
    ["active", "admin", false, null],
    ["completed", "admin", false, null],
    ["locked", "admin", false, null],
    ["setup", "supervisor", false, null],
    ["active", "supervisor", false, null],
    ["completed", "supervisor", false, CLOSED_MSG],
    ["locked", "supervisor", false, CLOSED_MSG],
    ["setup", "admin", true, null],
    ["active", "admin", true, null],
    ["completed", "admin", true, DELETE_MSG],
    ["locked", "admin", true, DELETE_MSG],
    ["active", "supervisor", true, null],
    ["completed", "supervisor", true, DELETE_MSG],
  ] as const)("%s / %s / deletesCounts=%s -> %s", async (status, userType, deletesCounts, expected) => {
    expect(await check(status, userType, deletesCounts)).toBe(expected);
  });

  it("defaults deletesCounts to false", async () => {
    expect(await check("locked", "admin")).toBeNull();
  });

  it("blocks non-admins on an unrecognised status but lets admins through", async () => {
    expect(await check("archived", "supervisor")).toBe(CLOSED_MSG);
    expect(await check("archived", "admin")).toBeNull();
  });
});
