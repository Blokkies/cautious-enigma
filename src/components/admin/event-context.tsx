"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { safeJsonParse } from "@/lib/utils";

/** One event as returned by GET /api/admin/events. */
export interface AdminEvent {
  id: number;
  name: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Raw JSON array of selected warehouses; null = all. Use `selectedWarehouses` instead. */
  warehouses: string | null;
  /** Parsed warehouse selection; null = all warehouses. */
  selectedWarehouses: string[] | null;
  uploadId: number | null;
  /** All imported items (any warehouse). */
  totalItemCount: number;
  /** Imported items that are assigned to a team. */
  itemCount: number;
  teamCount: number;
  supervisorCount: number;
}

export interface AdminEventState {
  eventId: number;
  /** null while loading the first time, on error, or when the event doesn't exist. */
  event: AdminEvent | null;
  /** True only during the first load (reloads keep showing the current event). */
  loading: boolean;
  /** Load error message, or null. */
  error: string | null;
  /** Loaded fine, but no event has this id. */
  notFound: boolean;
  /** Re-fetch the event (call after any change: rename, status change, import...). */
  reload: () => Promise<void>;
}

const AdminEventContext = createContext<AdminEventState | null>(null);

type RawEvent = Omit<AdminEvent, "selectedWarehouses">;

/** Loads one event for the workspace / wizard under /admin/events/[id]. */
export function AdminEventProvider({ eventId, children }: { eventId: number; children: React.ReactNode }) {
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const res = await fetch("/api/admin/events", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(data.error || `Could not load the event (HTTP ${res.status}).`);
        return;
      }
      const found = ((data.events ?? []) as RawEvent[]).find((e) => e.id === eventId);
      setError(null);
      setNotFound(!found);
      setEvent(
        found
          ? {
              ...found,
              selectedWarehouses: safeJsonParse<string[] | null>(found.warehouses, null),
            }
          : null
      );
    } catch {
      if (id !== requestId.current) return;
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void reload();
  }, [reload]);

  const value = useMemo<AdminEventState>(
    () => ({ eventId, event, loading, error, notFound, reload }),
    [eventId, event, loading, error, notFound, reload]
  );

  return <AdminEventContext.Provider value={value}>{children}</AdminEventContext.Provider>;
}

/** The current event under /admin/events/[id]/**. Throws outside AdminEventProvider. */
export function useAdminEvent(): AdminEventState {
  const ctx = useContext(AdminEventContext);
  if (!ctx) throw new Error("useAdminEvent must be used inside <AdminEventProvider> (/admin/events/[id]/...)");
  return ctx;
}
