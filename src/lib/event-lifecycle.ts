// Which status changes and destructive actions the admin UI offers for an event, and
// how each one is sent to the server. Pure: mirrors the rules in event-status.ts and the
// reset/delete guards in the activate/events routes so the UI only offers valid actions.

export type LifecycleActionId =
  | "go-live"
  | "back-to-setup"
  | "complete"
  | "lock"
  | "reopen"
  | "reset"
  | "delete";

export interface LifecycleRequest {
  method: "POST" | "PUT" | "DELETE";
  url: string;
  body: Record<string, unknown>;
}

/** Status-changing actions (not reset/delete), in the order they appear for a status. */
const TRANSITIONS: Record<string, LifecycleActionId[]> = {
  setup: ["go-live"],
  active: ["complete", "back-to-setup"],
  completed: ["lock"],
  locked: ["reopen"],
};

/** The status each transition leads to. */
export const TRANSITION_TARGET: Partial<Record<LifecycleActionId, string>> = {
  "go-live": "active",
  "back-to-setup": "setup",
  complete: "completed",
  lock: "locked",
  reopen: "active",
};

/** Status changes available from `status` (empty for an unknown status). */
export function statusTransitions(status: string): LifecycleActionId[] {
  return TRANSITIONS[status] ?? [];
}

/**
 * Destructive actions available from `status`. Reset deletes counts, so the server refuses
 * it for completed/locked events. Delete is always offered; the server refuses a closed
 * event that has counts and the dialog shows that message.
 */
export function dangerActions(status: string): LifecycleActionId[] {
  if (status === "setup" || status === "active") return ["reset", "delete"];
  return ["delete"];
}

/**
 * The header's main next step. Setup events go to the wizard ("continue-setup") until they
 * are ready, then offer Go live.
 */
export function primaryAction(status: string, setupReady: boolean): LifecycleActionId | "continue-setup" | null {
  if (status === "setup") return setupReady ? "go-live" : "continue-setup";
  return statusTransitions(status)[0] ?? null;
}

/** The API call for an action. */
export function lifecycleRequest(action: LifecycleActionId, eventId: number): LifecycleRequest {
  switch (action) {
    case "go-live":
      return { method: "POST", url: "/api/admin/activate", body: { eventId } };
    case "back-to-setup":
      return { method: "PUT", url: "/api/admin/activate", body: { eventId, status: "setup" } };
    case "complete":
      return { method: "PUT", url: "/api/admin/events", body: { id: eventId, status: "completed" } };
    case "lock":
      return { method: "PUT", url: "/api/admin/events", body: { id: eventId, status: "locked" } };
    case "reopen":
      return { method: "PUT", url: "/api/admin/events", body: { id: eventId, status: "active" } };
    case "reset":
      return { method: "PUT", url: "/api/admin/activate", body: { eventId, action: "reset" } };
    case "delete":
      return { method: "DELETE", url: "/api/admin/events", body: { id: eventId } };
  }
}
