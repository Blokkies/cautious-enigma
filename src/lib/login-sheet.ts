// Login sheet content (site address, event, names and PINs) for handing out on count day.
// Pure so the printable view and the clipboard text stay in step.

export interface LoginSheetPerson {
  name: string;
  /** Plain PIN; null/undefined when unknown (older accounts created before PINs were stored). */
  pin?: string | null;
  /** Team members, shown under the team name. */
  members?: string[];
}

export interface LoginSheetData {
  siteUrl: string;
  eventName: string;
  teams: LoginSheetPerson[];
  supervisors: LoginSheetPerson[];
  auditors: LoginSheetPerson[];
}

const naturalName = (a: LoginSheetPerson, b: LoginSheetPerson) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** People sorted by name with numbers in natural order ("Team 2" before "Team 10"). */
export function sortPeople(list: LoginSheetPerson[]): LoginSheetPerson[] {
  return [...list].sort(naturalName);
}

function section(title: string, people: LoginSheetPerson[]): string[] {
  if (people.length === 0) return [];
  const width = Math.max(...people.map((p) => p.name.length));
  return [
    "",
    `${title} (${people.length})`,
    ...sortPeople(people).map((p) => {
      const pin = p.pin ? p.pin : "(PIN not stored, reset it on the People tab)";
      const members = p.members && p.members.length > 0 ? `  [${p.members.join(", ")}]` : "";
      return `  ${p.name.padEnd(width)}  PIN ${pin}${members}`;
    }),
  ];
}

/** One sentence on how to log in. */
export function loginInstructions(data: Pick<LoginSheetData, "siteUrl" | "eventName">): string {
  return `Open ${data.siteUrl} on your phone or tablet, choose your role (Team, Supervisor or Auditor), choose "${data.eventName}", pick your name and enter your PIN.`;
}

/** Plain-text login sheet for the clipboard. */
export function loginSheetText(data: LoginSheetData): string {
  return [
    `${data.eventName}: login details`,
    loginInstructions(data),
    ...section("Teams", data.teams),
    ...section("Supervisors", data.supervisors),
    ...section("Auditors", data.auditors),
  ].join("\n");
}
