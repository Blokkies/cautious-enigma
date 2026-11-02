"use client";

import { useState, useEffect, useCallback } from "react";
import type { EventOption, VarianceItem } from "./types";

/**
 * Variance lists (active / accepted / resolved) + header stats, polled every 15s.
 * Executives first pick an event (defaults to the active one).
 */
export function useVariancesData(isExecutive: boolean) {
  // Executive event picker
  const [execEvents, setExecEvents] = useState<EventOption[]>([]);
  const [execEventId, setExecEventId] = useState<number>(0);

  const [activeVariances, setActiveVariances] = useState<VarianceItem[]>([]);
  const [acceptedVariances, setAcceptedVariances] = useState<VarianceItem[]>([]);
  const [resolvedVariances, setResolvedVariances] = useState<VarianceItem[]>([]);
  const [activeTotalValue, setActiveTotalValue] = useState(0);
  const [overCount, setOverCount] = useState(0);
  const [underCount, setUnderCount] = useState(0);
  const [overValue, setOverValue] = useState(0);
  const [underValue, setUnderValue] = useState(0);
  const [netVarianceValue, setNetVarianceValue] = useState(0);
  // Accepted tab stats
  const [acceptedTotalValue, setAcceptedTotalValue] = useState(0);
  const [acceptedOverCount, setAcceptedOverCount] = useState(0);
  const [acceptedUnderCount, setAcceptedUnderCount] = useState(0);
  const [acceptedOverValue, setAcceptedOverValue] = useState(0);
  const [acceptedUnderValue, setAcceptedUnderValue] = useState(0);
  const [acceptedNetVarianceValue, setAcceptedNetVarianceValue] = useState(0);
  const [loading, setLoading] = useState(true);

  const [execEventsLoaded, setExecEventsLoaded] = useState(!isExecutive);

  // Fetch events list for executive event picker
  useEffect(() => {
    if (!isExecutive) return;
    (async () => {
      try {
        const res = await fetch("/api/executive/dashboard");
        if (res.ok) {
          const data = await res.json();
          const evts: EventOption[] = (data.events || []).map((e: { id: number; name: string; status: string }) => ({ id: e.id, name: e.name, status: e.status }));
          setExecEvents(evts);
          if (evts.length > 0 && execEventId === 0) {
            const active = evts.find((e) => e.status === "active");
            setExecEventId(active?.id ?? evts[0].id);
          }
        }
      } catch {}
      setExecEventsLoaded(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecutive]);

  const loadVariances = useCallback(async () => {
    // Executive must wait for event list to load and pick an event
    if (isExecutive && (!execEventsLoaded || !execEventId)) return;

    const eidParam = isExecutive ? `eventId=${execEventId}&` : "";
    try {
      const [activeRes, acceptedRes, resolvedRes] = await Promise.all([
        fetch(`/api/supervisor/variances?${eidParam}`),
        fetch(`/api/supervisor/variances?${eidParam}tab=accepted`),
        fetch(`/api/supervisor/variances?${eidParam}tab=resolved`),
      ]);

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveVariances(data.variances || []);
        setActiveTotalValue(data.totalVarianceValue || 0);
        setOverCount(data.overCount || 0);
        setUnderCount(data.underCount || 0);
        setOverValue(data.overValue || 0);
        setUnderValue(data.underValue || 0);
        setNetVarianceValue(data.netVarianceValue || 0);
      }

      if (acceptedRes.ok) {
        const data = await acceptedRes.json();
        setAcceptedVariances(data.variances || []);
        setAcceptedTotalValue(data.totalVarianceValue || 0);
        setAcceptedOverCount(data.overCount || 0);
        setAcceptedUnderCount(data.underCount || 0);
        setAcceptedOverValue(data.overValue || 0);
        setAcceptedUnderValue(data.underValue || 0);
        setAcceptedNetVarianceValue(data.netVarianceValue || 0);
      }

      if (resolvedRes.ok) {
        const data = await resolvedRes.json();
        setResolvedVariances(data.variances || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecutive, execEventId, execEventsLoaded]);

  useEffect(() => {
    loadVariances();
    const interval = setInterval(loadVariances, 15000);
    return () => clearInterval(interval);
  }, [loadVariances]);

  return {
    execEvents,
    execEventId,
    setExecEventId,
    activeVariances,
    setActiveVariances,
    acceptedVariances,
    setAcceptedVariances,
    resolvedVariances,
    setResolvedVariances,
    activeTotalValue,
    setActiveTotalValue,
    activeStats: { overCount, underCount, overValue, underValue, netVarianceValue, totalValue: activeTotalValue },
    acceptedStats: {
      overCount: acceptedOverCount,
      underCount: acceptedUnderCount,
      overValue: acceptedOverValue,
      underValue: acceptedUnderValue,
      netVarianceValue: acceptedNetVarianceValue,
      totalValue: acceptedTotalValue,
    },
    loading,
    setLoading,
    loadVariances,
  };
}

export type VariancesData = ReturnType<typeof useVariancesData>;
export type VarianceStats = VariancesData["activeStats"];
