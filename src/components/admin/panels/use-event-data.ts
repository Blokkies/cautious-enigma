"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SetupCounts } from "@/lib/setup-progress";

export interface FetchState<T> {
  data: T | null;
  /** True until the first response (or error). */
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** GET a JSON resource; only the newest request may update state. `url` null = don't fetch. */
export function useJson<T>(url: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!url) return;
    const id = ++requestId.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(body.error || `Request failed (HTTP ${res.status}).`);
        return;
      }
      setError(null);
      setData(body as T);
    } catch {
      if (id === requestId.current) setError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void reload();
  }, [reload]);

  return { data, loading: loading && !!url, error, reload };
}

/** GET /api/admin/activate?eventId: go-live readiness in the event's warehouse scope. */
export interface Readiness {
  hasItems: boolean;
  hasTeams: boolean;
  hasSupervisors: boolean;
  allItemsAssigned: boolean;
  unassignedCount: number;
  itemCount?: number;
  teamCount?: number;
  supervisorCount?: number;
  /** Why the server would refuse going live, or null. */
  blocker: string | null;
}

/** Setup counts for setupProgress(). Falls back to the flags when a count is missing. */
export function readinessCounts(r: Readiness): SetupCounts {
  return {
    itemCount: r.itemCount ?? (r.hasItems ? 1 : 0),
    teamCount: r.teamCount ?? (r.hasTeams ? 1 : 0),
    supervisorCount: r.supervisorCount ?? (r.hasSupervisors ? 1 : 0),
    unassignedCount: r.unassignedCount,
  };
}

export function useReadiness(eventId: number): FetchState<Readiness> {
  return useJson<Readiness>(`/api/admin/activate?eventId=${eventId}`);
}

export interface WarehouseStat {
  warehouse: string;
  itemCount: number;
  binCount: number;
  totalValue: number;
}

/** GET /api/admin/import?eventId: the event's items at a glance. */
export interface ItemsOverview {
  eventId: number;
  status: string;
  summary: { totalItems: number; uniqueBins: number; uniqueBrands: number; totalValue: number };
  warehouses: WarehouseStat[];
  /** null = all warehouses. */
  selectedWarehouses: string[] | null;
  upload: { filename: string; fileSize: number; createdAt: string } | null;
}

export function useItemsOverview(eventId: number): FetchState<ItemsOverview> {
  return useJson<ItemsOverview>(`/api/admin/import?eventId=${eventId}`);
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Readiness of the current workspace/wizard event. Re-fetches automatically whenever the
 * event context reloads with different counts or status (panels call reload() after changes).
 * Pass `enabled: false` to skip the request (e.g. events that are not in setup).
 */
export function useEventReadiness(
  event: { id: number; status: string; updatedAt: string; teamCount: number; supervisorCount: number; itemCount: number; totalItemCount: number } | null,
  enabled = true
): FetchState<Readiness> {
  const version = event
    ? [event.status, event.updatedAt, event.teamCount, event.supervisorCount, event.itemCount, event.totalItemCount].join("_")
    : "";
  return useJson<Readiness>(
    event && enabled ? `/api/admin/activate?eventId=${event.id}&v=${encodeURIComponent(version)}` : null
  );
}
