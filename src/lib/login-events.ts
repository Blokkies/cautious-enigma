/**
 * Event statuses offered to each PIN-login role.
 * Teams may only log into events still open for counting; /api/auth/login
 * enforces TEAM_LOGIN_STATUSES. Supervisors/auditors can also review completed
 * events, which is what the login picker (/api/auth/list) offers them.
 */
export const TEAM_LOGIN_STATUSES: readonly string[] = ["active", "setup"];
export const STAFF_LOGIN_STATUSES: readonly string[] = ["active", "setup", "completed"];

export function loginStatusesFor(type: "team" | "supervisor" | "auditor"): readonly string[] {
  return type === "team" ? TEAM_LOGIN_STATUSES : STAFF_LOGIN_STATUSES;
}
