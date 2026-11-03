import { describe, expect, it } from "vitest";
import { canActivate, checkActivatePutTransition, checkEventsPutTransition } from "./event-status";
import { dangerActions, lifecycleRequest, primaryAction, statusTransitions, TRANSITION_TARGET } from "./event-lifecycle";

describe("statusTransitions", () => {
  it("offers only the transitions the server allows", () => {
    expect(statusTransitions("setup")).toEqual(["go-live"]);
    expect(statusTransitions("active")).toEqual(["complete", "back-to-setup"]);
    expect(statusTransitions("completed")).toEqual(["lock"]);
    expect(statusTransitions("locked")).toEqual(["reopen"]);
    expect(statusTransitions("weird")).toEqual([]);
  });

  it("every offered transition is accepted by the API it is sent to", () => {
    for (const from of ["setup", "active", "completed", "locked"]) {
      for (const action of statusTransitions(from)) {
        const to = TRANSITION_TARGET[action]!;
        const req = lifecycleRequest(action, 1);
        if (req.method === "POST") {
          expect(canActivate(from)).toBe(true);
          expect(to).toBe("active");
        } else if (req.url === "/api/admin/activate") {
          expect(checkActivatePutTransition(from, to)).toEqual({ ok: true, changed: true });
          expect(req.body.status).toBe(to);
        } else {
          expect(checkEventsPutTransition(from, to)).toEqual({ ok: true, changed: true });
          expect(req.body.status).toBe(to);
        }
      }
    }
  });
});

describe("dangerActions", () => {
  it("never offers reset once counting has finished", () => {
    expect(dangerActions("setup")).toEqual(["reset", "delete"]);
    expect(dangerActions("active")).toEqual(["reset", "delete"]);
    expect(dangerActions("completed")).toEqual(["delete"]);
    expect(dangerActions("locked")).toEqual(["delete"]);
  });
});

describe("primaryAction", () => {
  it("sends setup events to the wizard until they are ready", () => {
    expect(primaryAction("setup", false)).toBe("continue-setup");
    expect(primaryAction("setup", true)).toBe("go-live");
    expect(primaryAction("active", false)).toBe("complete");
    expect(primaryAction("completed", false)).toBe("lock");
    expect(primaryAction("locked", false)).toBe("reopen");
    expect(primaryAction("weird", false)).toBeNull();
  });
});

describe("lifecycleRequest", () => {
  it("builds reset and delete requests", () => {
    expect(lifecycleRequest("reset", 4)).toEqual({ method: "PUT", url: "/api/admin/activate", body: { eventId: 4, action: "reset" } });
    expect(lifecycleRequest("delete", 4)).toEqual({ method: "DELETE", url: "/api/admin/events", body: { id: 4 } });
  });
});
