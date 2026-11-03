import { describe, expect, it } from "vitest";
import { setupProgress } from "./setup-progress";

const base = { itemCount: 10, teamCount: 2, supervisorCount: 1, unassignedCount: 0 };

describe("setupProgress", () => {
  it("starts at the stock file when there are no items", () => {
    expect(setupProgress({ ...base, itemCount: 0 }).next).toBe("items");
  });
  it("asks for people when teams or supervisors are missing", () => {
    expect(setupProgress({ ...base, teamCount: 0 }).next).toBe("people");
    expect(setupProgress({ ...base, supervisorCount: 0 }).next).toBe("people");
  });
  it("asks for bins while items are unassigned", () => {
    const p = setupProgress({ ...base, unassignedCount: 3 });
    expect(p.next).toBe("bins");
    expect(p.ready).toBe(false);
    expect(p.done.bins).toBe(false);
  });
  it("is ready for review when everything is in place", () => {
    const p = setupProgress(base);
    expect(p).toMatchObject({ next: "review", ready: true });
    expect(p.done).toMatchObject({ details: true, items: true, people: true, bins: true });
  });
});
