"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCheck, Lock, Play, RotateCcw, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminRoutes } from "@/lib/admin-routes";
import {
  dangerActions,
  lifecycleRequest,
  statusTransitions,
  type LifecycleActionId,
} from "@/lib/event-lifecycle";
import { useAdminEvent } from "../event-context";
import { useConfirm, type ConfirmOptions } from "../confirm-dialog";
import { PanelSection } from "./panel-section";

interface ActionCopy {
  label: string;
  icon: LucideIcon;
  /** One line shown next to the button. */
  summary: string;
  confirm: (eventName: string) => Omit<ConfirmOptions, "onConfirm">;
  success: (eventName: string) => string;
}

export const LIFECYCLE_COPY: Record<LifecycleActionId, ActionCopy> = {
  "go-live": {
    label: "Go live",
    icon: Play,
    summary: "Open counting for every team at once.",
    confirm: (name) => ({
      title: `Go live with "${name}"?`,
      description: (
        <ul className="list-disc space-y-1 pl-5">
          <li>Teams can start counting their assigned bins straight away.</li>
          <li>Supervisors see progress and variances as counts come in.</li>
          <li>The stock file and warehouse selection are locked.</li>
          <li>You can still edit teams, PINs and bin assignments, and move back to setup if needed.</li>
        </ul>
      ),
      confirmLabel: "Go live",
    }),
    success: (name) => `${name} is live. Teams can start counting.`,
  },
  "back-to-setup": {
    label: "Move back to setup",
    icon: Undo2,
    summary: "Pause counting to fix the setup. Counts already recorded are kept.",
    confirm: (name) => ({
      title: `Move "${name}" back to setup?`,
      description: (
        <ul className="list-disc space-y-1 pl-5">
          <li>Counting stops: teams can no longer submit counts until you go live again.</li>
          <li>Counts already recorded are kept.</li>
          <li>You can change the warehouse selection or replace the stock file. Replacing the file deletes the recorded counts, and you are asked first.</li>
        </ul>
      ),
      confirmLabel: "Move to setup",
    }),
    success: (name) => `${name} is back in setup.`,
  },
  complete: {
    label: "Mark complete",
    icon: CheckCheck,
    summary: "Stop counting and freeze the results for review and export.",
    confirm: (name) => ({
      title: `Mark "${name}" as complete?`,
      description: (
        <ul className="list-disc space-y-1 pl-5">
          <li>Teams can no longer submit counts. Supervisors keep read-only access.</li>
          <li>Results and NetSuite exports are ready on the Results and Exports tabs.</li>
          <li>To count again later you would lock the stocktake and then reopen it.</li>
        </ul>
      ),
      confirmLabel: "Mark complete",
    }),
    success: (name) => `${name} is complete. Review the results and export them.`,
  },
  lock: {
    label: "Lock",
    icon: Lock,
    summary: "Archive it once exports are done. Nothing can change while locked.",
    confirm: (name) => ({
      title: `Lock "${name}"?`,
      description: (
        <ul className="list-disc space-y-1 pl-5">
          <li>The stocktake is archived and nothing can change.</li>
          <li>Results and exports stay available.</li>
          <li>An admin can reopen it for counting later if needed.</li>
        </ul>
      ),
      confirmLabel: "Lock stocktake",
    }),
    success: (name) => `${name} is locked.`,
  },
  reopen: {
    label: "Reopen for counting",
    icon: RotateCcw,
    summary: "Make it live again so teams can count and supervisors can review.",
    confirm: (name) => ({
      title: `Reopen "${name}" for counting?`,
      description: (
        <ul className="list-disc space-y-1 pl-5">
          <li>The stocktake becomes live again: teams can log in and submit counts.</li>
          <li>Existing counts and results are kept and may change as new counts arrive.</li>
          <li>Re-export to NetSuite afterwards if you already exported.</li>
        </ul>
      ),
      confirmLabel: "Reopen",
    }),
    success: (name) => `${name} is live again.`,
  },
  reset: {
    label: "Reset",
    icon: Archive,
    summary: "Delete all counts, people and assignments but keep the imported items. Returns to setup.",
    confirm: (name) => ({
      title: `Reset "${name}"?`,
      description: (
        <>
          <p>This permanently deletes:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>every count, query, breakdown and serial discrepancy;</li>
            <li>all teams, supervisors and auditors;</li>
            <li>all bin assignments.</li>
          </ul>
          <p>The imported items and warehouse selection are kept and the stocktake returns to setup. This cannot be undone.</p>
        </>
      ),
      confirmLabel: "Reset stocktake",
      destructive: true,
      confirmText: name,
    }),
    success: (name) => `${name} was reset and is back in setup.`,
  },
  delete: {
    label: "Delete",
    icon: Trash2,
    summary: "Remove the stocktake and everything in it.",
    confirm: (name) => ({
      title: `Delete "${name}"?`,
      description: (
        <>
          <p>
            The stocktake and all its data (items, counts, teams, supervisors, queries and assignments) are removed
            permanently. This cannot be undone.
          </p>
          <p>Completed or locked stocktakes with counts can&apos;t be deleted, so their final figures are kept.</p>
        </>
      ),
      confirmLabel: "Delete stocktake",
      destructive: true,
      confirmText: name,
    }),
    success: (name) => `${name} was deleted.`,
  },
};

/**
 * Runs a lifecycle action for the current event: shows its confirmation, sends the request,
 * reloads the event and toasts. Delete navigates to the events list. Render `dialog` once.
 */
export function useLifecycleAction(options: { onDone?: (action: LifecycleActionId) => void } = {}) {
  const { event, reload } = useAdminEvent();
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const { onDone } = options;

  const run = useCallback(
    async (action: LifecycleActionId): Promise<boolean> => {
      if (!event) return false;
      const copy = LIFECYCLE_COPY[action];
      const req = lifecycleRequest(action, event.id);
      const ok = await confirm({
        ...copy.confirm(event.name),
        onConfirm: async () => {
          let res: Response;
          try {
            res = await fetch(req.url, {
              method: req.method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(req.body),
            });
          } catch {
            throw new Error("Could not reach the server. Nothing was changed.");
          }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `The request failed (HTTP ${res.status}).`);
          }
        },
      });
      if (!ok) return false;
      toast.success(copy.success(event.name));
      if (action === "delete") {
        router.push(adminRoutes.events);
      } else {
        await reload();
      }
      onDone?.(action);
      return true;
    },
    [event, confirm, reload, router, onDone]
  );

  return { run, dialog };
}

/**
 * Every status change available for the event, plus reset and delete, each with a short
 * explanation. Only valid transitions for the current status are shown.
 */
export function LifecycleActions({
  onDone,
  goLiveDisabledReason,
}: {
  onDone?: (action: LifecycleActionId) => void;
  /** Disable Go live with this explanation (e.g. readiness blocker). */
  goLiveDisabledReason?: string | null;
}) {
  const { event } = useAdminEvent();
  const { run, dialog } = useLifecycleAction({ onDone });
  if (!event) return null;
  const transitions = statusTransitions(event.status);
  const dangers = dangerActions(event.status);

  return (
    <div className="space-y-6">
      {transitions.length > 0 && (
        <PanelSection title="Change status" description="Move the stocktake to its next stage. Each step explains what changes before anything happens." bodyClassName="p-0 sm:p-0">
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {transitions.map((a, i) => {
              const copy = LIFECYCLE_COPY[a];
              const Icon = copy.icon;
              const blocked = a === "go-live" ? goLiveDisabledReason : null;
              return (
                <li key={a} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{copy.label}</div>
                    <div className="text-sm text-slate-600">{blocked || copy.summary}</div>
                  </div>
                  <Button variant={i === 0 ? "default" : "outline"} onClick={() => void run(a)} disabled={!!blocked} className="shrink-0">
                    <Icon />
                    {copy.label}
                  </Button>
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}

      <section className="rounded-lg border border-red-200 bg-white" aria-labelledby="danger-zone">
        <h3 id="danger-zone" className="px-4 pt-4 text-base font-semibold text-red-800 sm:px-5">
          Danger zone
        </h3>
        <ul className="mt-3 divide-y divide-red-100 border-t border-red-100">
          {dangers.map((a) => {
            const copy = LIFECYCLE_COPY[a];
            const Icon = copy.icon;
            return (
              <li key={a} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">{copy.label} stocktake</div>
                  <div className="text-sm text-slate-600">{copy.summary}</div>
                </div>
                <Button variant="outline" className="shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => void run(a)}>
                  <Icon />
                  {copy.label}
                </Button>
              </li>
            );
          })}
        </ul>
        {!dangers.includes("reset") && (
          <p className="border-t border-red-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            Reset is not available once counting has finished, so the final counts are kept.
          </p>
        )}
      </section>

      {dialog}
    </div>
  );
}
