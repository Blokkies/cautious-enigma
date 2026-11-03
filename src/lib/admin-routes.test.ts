import { describe, expect, it } from "vitest";
import { activeEventTab, adminRoutes, isNavActive, legacyAdminRedirect } from "./admin-routes";

const q = (s: string) => new URLSearchParams(s);

describe("legacyAdminRedirect", () => {
  it.each([
    ["/admin/dashboard", "", "/admin"],
    ["/admin/setup", "", "/admin/events"],
    ["/admin/setup", "eventId=4", "/admin/events/4"],
    ["/admin/import", "eventId=12", "/admin/events/12/items"],
    ["/admin/import", "", "/admin/events"],
    ["/admin/teams", "eventId=12", "/admin/events/12/people"],
    ["/admin/teams", "", "/admin/events"],
    ["/admin/teams/assign", "eventId=12", "/admin/events/12/bins"],
    ["/admin/teams/assign", "", "/admin/events"],
    ["/admin/activate", "eventId=12", "/admin/events/12"],
    ["/admin/activate", "", "/admin/events"],
    ["/admin/summary", "eventId=12", "/admin/events/12/results"],
    ["/admin/summary", "", "/admin/events"],
    ["/admin/export", "", "/admin/exports"],
    ["/admin/export", "eventId=12", "/admin/events/12/exports"],
    ["/admin/netsuite-export", "eventId=12", "/admin/exports"],
    ["/admin/settings", "", "/admin/accounts"],
  ])("%s?%s -> %s", (path, query, expected) => {
    expect(legacyAdminRedirect(path, q(query))).toBe(expected);
  });

  it("ignores a trailing slash", () => {
    expect(legacyAdminRedirect("/admin/teams/assign/", q("eventId=3"))).toBe("/admin/events/3/bins");
  });

  it.each(["abc", "0", "-1", "1.5", "", "99999999999999999999"])("drops invalid eventId %j", (id) => {
    expect(legacyAdminRedirect("/admin/import", q(`eventId=${id}`))).toBe("/admin/events");
  });

  it("accepts a plain object (page searchParams)", () => {
    expect(legacyAdminRedirect("/admin/summary", { eventId: "7" })).toBe("/admin/events/7/results");
    expect(legacyAdminRedirect("/admin/summary", { eventId: ["8", "9"] })).toBe("/admin/events/8/results");
  });

  it.each(["/admin", "/admin/events", "/admin/events/1/items", "/admin/files", "/admin/accounts", "/admin/exports", "/admin/help", "/supervisor/export", "/admin/teamsx"])(
    "leaves %s alone",
    (path) => {
      expect(legacyAdminRedirect(path, q("eventId=1"))).toBeNull();
    }
  );
});

describe("isNavActive", () => {
  it("Overview only matches /admin itself", () => {
    expect(isNavActive("/admin", "/admin")).toBe(true);
    expect(isNavActive("/admin", "/admin/")).toBe(true);
    expect(isNavActive("/admin", "/admin/events")).toBe(false);
  });

  it("other items match nested routes on segment boundaries", () => {
    expect(isNavActive("/admin/events", "/admin/events")).toBe(true);
    expect(isNavActive("/admin/events", "/admin/events/12/setup/items")).toBe(true);
    expect(isNavActive("/admin/exports", "/admin/events/12/exports")).toBe(false);
    expect(isNavActive("/admin/files", "/admin/filesx")).toBe(false);
  });
});

describe("adminRoutes", () => {
  it("builds workspace and wizard URLs", () => {
    expect(adminRoutes.event(5)).toBe("/admin/events/5");
    expect(adminRoutes.event(5, "bins")).toBe("/admin/events/5/bins");
    expect(adminRoutes.setup(5, "review")).toBe("/admin/events/5/setup/review");
    expect(adminRoutes.help("import-file")).toBe("/admin/help#import-file");
  });
});

describe("activeEventTab", () => {
  it.each([
    ["/admin/events/5", "overview"],
    ["/admin/events/5/", "overview"],
    ["/admin/events/5/items", "items"],
    ["/admin/events/5/people", "people"],
    ["/admin/events/5/bins", "bins"],
    ["/admin/events/5/results", "results"],
    ["/admin/events/5/exports", "exports"],
    ["/admin/events/5/setup/items", "overview"],
    ["/admin/events/55/items", "overview"],
  ])("%s -> %s", (path, tab) => {
    expect(activeEventTab(path, 5)).toBe(tab);
  });
});
