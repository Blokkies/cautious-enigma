import { describe, expect, it } from "vitest";
import { loginSheetText, sortPeople } from "./login-sheet";

describe("sortPeople", () => {
  it("sorts numbered names naturally", () => {
    expect(sortPeople([{ name: "Team 10" }, { name: "Team 2" }, { name: "team 1" }]).map((p) => p.name)).toEqual([
      "team 1",
      "Team 2",
      "Team 10",
    ]);
  });
});

describe("loginSheetText", () => {
  it("lists the site, event, and every person with their PIN", () => {
    const text = loginSheetText({
      siteUrl: "https://count.example.com",
      eventName: "Year end",
      teams: [
        { name: "Team 2", pin: "1002", members: ["Ann", "Ben"] },
        { name: "Team 1", pin: "1001" },
      ],
      supervisors: [{ name: "Sam", pin: "9999" }],
      auditors: [],
    });
    expect(text).toContain("https://count.example.com");
    expect(text).toContain("Year end");
    expect(text).toContain("Teams (2)");
    expect(text.indexOf("Team 1")).toBeLessThan(text.indexOf("Team 2"));
    expect(text).toMatch(/Team 2\s+PIN 1002\s+\[Ann, Ben\]/);
    expect(text).toContain("Supervisors (1)");
    expect(text).not.toContain("Auditors");
  });

  it("flags people whose PIN is not stored", () => {
    const text = loginSheetText({ siteUrl: "x", eventName: "E", teams: [{ name: "Old", pin: null }], supervisors: [], auditors: [] });
    expect(text).toContain("PIN not stored");
  });
});
