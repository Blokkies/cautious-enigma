"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface TeamCounts {
  queries: number;
  breakdowns: number;
  verifications: number;
}

interface SupervisorCounts {
  queries: number;
  breakdowns: number;
  serials: number;
}

const POLL_INTERVAL = 30_000; // 30 seconds
const MARK_SEEN_EVENT = "stocktake-mark-seen";

const LS_KEYS = {
  queries: "stocktake-lastSeen-queries",
  breakdowns: "stocktake-lastSeen-breakdowns",
  verifications: "stocktake-lastSeen-verifications",
  supervisorQueries: "stocktake-lastSeen-supervisor-queries",
  supervisorBreakdowns: "stocktake-lastSeen-supervisor-breakdowns",
  supervisorSerials: "stocktake-lastSeen-supervisor-serials",
} as const;

type SectionKey = keyof typeof LS_KEYS;

function getLastSeen(section: SectionKey): string {
  try {
    return localStorage.getItem(LS_KEYS[section]) || "1970-01-01T00:00:00Z";
  } catch {
    return "1970-01-01T00:00:00Z";
  }
}

/**
 * Call from any page to mark a section as "seen".
 * Updates localStorage and dispatches an event so the nav hook re-fetches.
 */
export function markNotificationSeen(section: SectionKey): void {
  try {
    localStorage.setItem(LS_KEYS[section], new Date().toISOString());
  } catch {
    // localStorage unavailable
  }
  window.dispatchEvent(new CustomEvent(MARK_SEEN_EVENT, { detail: { section } }));
}

// Map section keys to their count key in state
const TEAM_SECTION_TO_COUNT: Record<string, keyof TeamCounts> = {
  queries: "queries",
  breakdowns: "breakdowns",
  verifications: "verifications",
};

const SUPERVISOR_SECTION_TO_COUNT: Record<string, keyof SupervisorCounts> = {
  supervisorQueries: "queries",
  supervisorBreakdowns: "breakdowns",
  supervisorSerials: "serials",
};

export function useTeamNotifications() {
  const [counts, setCounts] = useState<TeamCounts>({ queries: 0, breakdowns: 0, verifications: 0 });
  const mountedRef = useRef(true);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        lastSeenQueries: getLastSeen("queries"),
        lastSeenBreakdowns: getLastSeen("breakdowns"),
        lastSeenVerifications: getLastSeen("verifications"),
      });
      const res = await fetch(`/api/team/notifications?${params}`);
      if (res.ok && mountedRef.current) {
        const data = await res.json();
        setCounts({
          queries: data.queries ?? 0,
          breakdowns: data.breakdowns ?? 0,
          verifications: data.verifications ?? 0,
        });
      }
    } catch {
      // offline or error — keep existing counts
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_INTERVAL);

    const handleMarkSeen = (e: Event) => {
      const { section } = (e as CustomEvent).detail as { section: string };
      const countKey = TEAM_SECTION_TO_COUNT[section];
      if (countKey) {
        setCounts((prev) => ({ ...prev, [countKey]: 0 }));
        setTimeout(fetchCounts, 500);
      }
    };
    window.addEventListener(MARK_SEEN_EVENT, handleMarkSeen);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      window.removeEventListener(MARK_SEEN_EVENT, handleMarkSeen);
    };
  }, [fetchCounts]);

  return { counts, refetch: fetchCounts };
}

export function useSupervisorNotifications() {
  const [counts, setCounts] = useState<SupervisorCounts>({ queries: 0, breakdowns: 0, serials: 0 });
  const mountedRef = useRef(true);

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        lastSeenQueries: getLastSeen("supervisorQueries"),
        lastSeenBreakdowns: getLastSeen("supervisorBreakdowns"),
        lastSeenSerials: getLastSeen("supervisorSerials"),
      });
      const res = await fetch(`/api/supervisor/notifications?${params}`);
      if (res.ok && mountedRef.current) {
        const data = await res.json();
        setCounts({
          queries: data.queries ?? 0,
          breakdowns: data.breakdowns ?? 0,
          serials: data.serials ?? 0,
        });
      }
    } catch {
      // offline or error
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_INTERVAL);

    const handleMarkSeen = (e: Event) => {
      const { section } = (e as CustomEvent).detail as { section: string };
      const countKey = SUPERVISOR_SECTION_TO_COUNT[section];
      if (countKey) {
        setCounts((prev) => ({ ...prev, [countKey]: 0 }));
        setTimeout(fetchCounts, 500);
      }
    };
    window.addEventListener(MARK_SEEN_EVENT, handleMarkSeen);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      window.removeEventListener(MARK_SEEN_EVENT, handleMarkSeen);
    };
  }, [fetchCounts]);

  return { counts, refetch: fetchCounts };
}
