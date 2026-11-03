import { describe, expect, it } from "vitest";
import { readinessLines } from "../panels/readiness-lines";

const ready = {
  hasItems: true,
  hasTeams: true,
  hasSupervisors: true,
  allItemsAssigned: true,
  unassignedCount: 0,
  itemCount: 1500,
  teamCount: 3,
  supervisorCount: 1,
  blocker: null,
};

describe("readinessLines", () => {
  it("marks every line done for a ready event", () => {
    const lines = readinessLines(ready);
    expect(lines.every((l) => l.ok)).toBe(true);
    expect(lines[0].detail).toBe("1 500 items in the selected warehouses");
    expect(lines[1].detail).toBe("3 teams");
  });

  it("points each open line at the step that fixes it", () => {
    const lines = readinessLines({ ...ready, hasSupervisors: false, supervisorCount: 0, allItemsAssigned: false, unassignedCount: 1 });
    expect(lines.filter((l) => !l.ok).map((l) => [l.key, l.step, l.detail])).toEqual([
      ["supervisors", "people", "No supervisor yet"],
      ["bins", "bins", "1 item unassigned"],
    ]);
  });

  it("does not call bins done when there are no items", () => {
    const lines = readinessLines({ ...ready, hasItems: false, itemCount: 0, allItemsAssigned: true });
    expect(lines.find((l) => l.key === "bins")).toMatchObject({ ok: false, detail: "Import items first" });
  });
});
