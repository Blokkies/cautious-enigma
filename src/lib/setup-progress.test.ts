import { describe, expect, it } from "vitest";
import { continueBlocker, isStepReachable, setupProgress, skipsWarehouses, stepAfter, stepBefore } from "./setup-progress";

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

describe("wizard navigation", () => {
  it("skips the warehouses step only when there is nothing to choose", () => {
    expect(skipsWarehouses(0)).toBe(true);
    expect(skipsWarehouses(1)).toBe(true);
    expect(skipsWarehouses(2)).toBe(false);
    expect(stepAfter("items", true)).toBe("people");
    expect(stepAfter("items", false)).toBe("warehouses");
    expect(stepBefore("people", true)).toBe("items");
    expect(stepBefore("people", false)).toBe("warehouses");
    expect(stepAfter("review", false)).toBeNull();
    expect(stepBefore("details", false)).toBeNull();
  });

  it("locks steps after the first unfinished one unless they are already done", () => {
    const noItems = setupProgress({ ...base, itemCount: 0 });
    expect(isStepReachable("details", noItems)).toBe(true);
    expect(isStepReachable("items", noItems)).toBe(true);
    expect(isStepReachable("bins", noItems)).toBe(false);
    expect(isStepReachable("people", noItems)).toBe(true); // already done
    expect(isStepReachable("review", setupProgress(base))).toBe(true);
  });

  it("explains why Continue is blocked", () => {
    expect(continueBlocker("details", { ...base, itemCount: 0 })).toBeNull();
    expect(continueBlocker("items", { ...base, itemCount: 0 })).toMatch(/Import a stock file/);
    expect(continueBlocker("people", { ...base, teamCount: 0, supervisorCount: 0 })).toMatch(/team and one supervisor/);
    expect(continueBlocker("people", { ...base, supervisorCount: 0 })).toMatch(/supervisor/);
    expect(continueBlocker("bins", { ...base, unassignedCount: 1234 })).toBe(
      "1 234 items are still unassigned. Assign every bin to continue."
    );
    expect(continueBlocker("bins", { ...base, teamCount: 0 })).toMatch(/Add a team/);
    expect(continueBlocker("bins", base)).toBeNull();
  });
});
