import { describe, expect, it } from "vitest";
import { statusMeta } from "../status";

describe("statusMeta", () => {
  it.each([
    ["setup", "In setup", 0, "blue"],
    ["active", "Live", 1, "emerald"],
    ["completed", "Completed", 2, "indigo"],
    ["locked", "Locked", 3, "slate"],
  ])("%s", (status, label, order, colour) => {
    const m = statusMeta(status);
    expect(m.label).toBe(label);
    expect(m.order).toBe(order);
    expect(m.badgeClass).toContain(colour);
    expect(m.description.length).toBeGreaterThan(20);
  });

  it("gives each known status a distinct colour", () => {
    const classes = ["setup", "active", "completed", "locked"].map((s) => statusMeta(s).badgeClass);
    expect(new Set(classes).size).toBe(4);
  });

  it("is case-insensitive and handles unknown values", () => {
    expect(statusMeta("ACTIVE").label).toBe("Live");
    expect(statusMeta("archived")).toMatchObject({ label: "Archived", order: -1 });
    expect(statusMeta(null).label).toBe("Unknown");
  });
});
