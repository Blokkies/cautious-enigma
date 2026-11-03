"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  dismissRejectedRecords,
  getRejectedRecords,
  retryRejectedRecords,
  type OfflineScope,
  type RejectedRecords,
} from "@/stores/offline-db";

const POLL_MS = 10_000;

/**
 * Shows records the server definitively rejected during offline sync (they are
 * otherwise invisible: kept in IndexedDB but never retried), with the reasons
 * and Retry / Dismiss actions.
 */
export function RejectedSyncBanner({
  scope,
  itemLabel,
  onChanged,
}: {
  scope: Partial<OfflineScope>;
  /** Resolve an item id to a display label (e.g. item code). */
  itemLabel?: (itemId: number) => string | undefined;
  /** Called after retry/dismiss so the page can reload its item state. */
  onChanged?: () => void;
}) {
  const [records, setRecords] = useState<RejectedRecords>({ counts: [], discrepancies: [] });
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const scopeEventId = scope.eventId;
  const scopeTeamId = scope.teamId;

  const refresh = useCallback(async () => {
    if (scopeEventId == null || scopeTeamId == null) return;
    try {
      setRecords(await getRejectedRecords({ eventId: scopeEventId, teamId: scopeTeamId }));
    } catch {
      // IndexedDB unavailable
    }
  }, [scopeEventId, scopeTeamId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const total = records.counts.length + records.discrepancies.length;
  if (total === 0) return null;

  const countIds = records.counts.map((c) => c.clientId);
  const discIds = records.discrepancies.map((d) => d.clientId);

  const retry = async () => {
    setBusy(true);
    try {
      const { requeued, dropped } = await retryRejectedRecords(countIds, discIds);
      if (requeued > 0) toast.info(`${requeued} record(s) queued to sync again`);
      if (dropped > 0) toast.info(`${dropped} older count(s) dropped — a newer count for the same item exists`);
      await refresh();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await dismissRejectedRecords(countIds, discIds);
      await refresh();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {total} {total === 1 ? "record was" : "records were"} rejected by the server
        </span>
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide reasons" : "Show reasons"}
        </button>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={retry}>
            Retry
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-1 text-xs">
          {records.counts.map((c) => (
            <li key={c.clientId} className="break-words">
              <span className="font-medium">
                {c.verificationId ? "Verification" : "Count"} {itemLabel?.(c.itemId) ?? `item #${c.itemId}`}
              </span>{" "}
              (qty {c.countedQty}): {c.syncError || "Rejected by server"}
            </li>
          ))}
          {records.discrepancies.map((d) => (
            <li key={d.clientId} className="break-words">
              <span className="font-medium">Unknown serials {d.itemCode}</span> ({d.unknownSerials.length}):{" "}
              {d.syncError || "Rejected by server"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
