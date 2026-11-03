"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  binKey,
  naturalCompare,
  toBinRef,
  type BalanceMode,
  type BinInfo,
  type BinItem,
  type BinRef,
  type BinSortMode,
  type TeamDetail,
} from "./assign-types";

export type BinSearchMode = "contains" | "starts" | "exact" | "range";

/** Tie-break bins with the same number by warehouse so the order is stable. */
function byWarehouse(a: BinInfo, b: BinInfo): number {
  return (a.warehouse ?? "").localeCompare(b.warehouse ?? "");
}

/**
 * State + handlers for the bin assignment page, shared by /admin/teams/assign and
 * /supervisor/teams/assign. `eventId` is the event being assigned (string, "" = none yet).
 */
export function useAssignment(eventId: string) {
  const [unassignedBins, setUnassignedBins] = useState<BinInfo[]>([]);
  const [teamDetails, setTeamDetails] = useState<TeamDetail[]>([]);
  const [stats, setStats] = useState({ total: 0, assigned: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);

  // Bin selection (unassigned). Bin Sets / caches in this hook are keyed by binKey(bin).
  const [selectedBins, setSelectedBins] = useState<Set<string>>(new Set());
  const [binSearch, setBinSearch] = useState("");
  const [binSearchMode, setBinSearchMode] = useState<BinSearchMode>("contains");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [assignToTeam, setAssignToTeam] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  // Team expand state
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());

  // Filters
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [filterOptions, setFilterOptions] = useState<{ brands: string[] }>({ brands: [] });

  // Bin items expansion
  const [expandedBins, setExpandedBins] = useState<Set<string>>(new Set());
  const [binItemsCache, setBinItemsCache] = useState<Record<string, BinItem[]>>({});
  const [loadingBinItems, setLoadingBinItems] = useState<Set<string>>(new Set());

  // Sorting
  const [binSort, setBinSort] = useState<BinSortMode>("natural");

  // Auto-balance
  const [balancing, setBalancing] = useState(false);
  const [balanceMode, setBalanceMode] = useState<BalanceMode>("equal-bins");
  const [balanceTeams, setBalanceTeams] = useState<Set<number>>(new Set());

  // Team bin selection (for bulk removal)
  const [selectedTeamBins, setSelectedTeamBins] = useState<Record<number, Set<string>>>({});

  const loadData = useCallback(async () => {
    if (!eventId) return; // nothing to load — `loading` below reports false
    try {
      const params = new URLSearchParams({ eventId });
      if (brandFilter) params.set("brand", brandFilter);
      const res = await fetch(`/api/admin/assign?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUnassignedBins(data.unassignedBins || []);
        setStats(data.stats);
        setTeamDetails(data.teamDetails || []);
        if (data.filterOptions) setFilterOptions(data.filterOptions);
      }
    } catch {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [eventId, brandFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sort comparator for bins
  const binComparator = useMemo(() => {
    switch (binSort) {
      case "natural":
        return (a: BinInfo, b: BinInfo) => naturalCompare(a.bin_number, b.bin_number) || byWarehouse(a, b);
      case "alpha":
        return (a: BinInfo, b: BinInfo) => a.bin_number.localeCompare(b.bin_number) || byWarehouse(a, b);
      case "items-desc":
        return (a: BinInfo, b: BinInfo) => b.item_count - a.item_count || naturalCompare(a.bin_number, b.bin_number) || byWarehouse(a, b);
      case "value-desc":
        return (a: BinInfo, b: BinInfo) => b.total_value - a.total_value || naturalCompare(a.bin_number, b.bin_number) || byWarehouse(a, b);
    }
  }, [binSort]);

  // Group unassigned bins by prefix
  const groupedBins = useMemo(() => {
    let filtered = unassignedBins;
    if (binSearchMode === "range") {
      if (rangeFrom.trim() || rangeTo.trim()) {
        const from = rangeFrom.trim().toLowerCase();
        const to = rangeTo.trim().toLowerCase();
        filtered = unassignedBins.filter((b) => {
          const v = b.bin_number.toLowerCase();
          if (from && to) {
            return naturalCompare(v, from) >= 0 && naturalCompare(v, to) <= 0;
          } else if (from) {
            return naturalCompare(v, from) >= 0;
          } else {
            return naturalCompare(v, to) <= 0;
          }
        });
      }
    } else if (binSearch.trim()) {
      const q = binSearch.toLowerCase();
      filtered = unassignedBins.filter((b) => {
        const v = b.bin_number.toLowerCase();
        switch (binSearchMode) {
          case "starts":
            return v.startsWith(q);
          case "exact":
            return v === q;
          case "contains":
          default:
            return v.includes(q);
        }
      });
    }

    const sorted = [...filtered].sort(binComparator);

    const groups: Record<string, BinInfo[]> = {};
    const groupOrder: string[] = [];
    for (const bin of sorted) {
      const match = bin.bin_number.match(/^([A-Za-z0-9]+?)[\.\-\s]/);
      const prefix = match ? match[1] : bin.bin_number.substring(0, 2);
      if (!groups[prefix]) {
        groups[prefix] = [];
        groupOrder.push(prefix);
      }
      groups[prefix].push(bin);
    }

    if (binSort === "natural") {
      groupOrder.sort(naturalCompare);
    } else if (binSort === "alpha") {
      groupOrder.sort((a, b) => a.localeCompare(b));
    }

    return groupOrder.map((prefix) => [prefix, groups[prefix]] as [string, BinInfo[]]);
  }, [unassignedBins, binSearch, binSearchMode, binComparator, binSort, rangeFrom, rangeTo]);

  const toggleBin = (key: string) => {
    setSelectedBins((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectGroup = (bins: BinInfo[]) => {
    setSelectedBins((prev) => {
      const next = new Set(prev);
      const allSelected = bins.every((b) => next.has(binKey(b)));
      if (allSelected) {
        bins.forEach((b) => next.delete(binKey(b)));
      } else {
        bins.forEach((b) => next.add(binKey(b)));
      }
      return next;
    });
  };

  const selectAll = () => {
    // Use the already-filtered bins from groupedBins
    const allFiltered = groupedBins.flatMap(([, bins]) => bins);
    setSelectedBins(new Set(allFiltered.map(binKey)));
  };

  const clearSelection = () => {
    setSelectedBins(new Set());
  };

  const handleBrandFilterChange = (value: string) => {
    setBrandFilter(value === "__all__" ? "" : value);
    setSelectedBins(new Set());
    setBinItemsCache({});
    setExpandedBins(new Set());
  };

  /** Admin event switcher: clear every selection tied to the previous event. */
  const resetForEventChange = () => {
    setSelectedBins(new Set());
    setBinItemsCache({});
    setExpandedBins(new Set());
    setBalanceTeams(new Set());
    setSelectedTeamBins({});
  };

  // Bin items expansion
  const toggleBinExpand = async (bin: BinInfo) => {
    const key = binKey(bin);
    setExpandedBins((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    if (!binItemsCache[key]) {
      setLoadingBinItems((prev) => new Set(prev).add(key));
      try {
        const params = new URLSearchParams({ eventId, binNumber: bin.bin_number, warehouse: bin.warehouse ?? "" });
        if (brandFilter) params.set("brand", brandFilter);
        const res = await fetch(`/api/admin/assign?${params}`);
        if (res.ok) {
          const data = await res.json();
          setBinItemsCache((prev) => ({ ...prev, [key]: data.binItems || [] }));
        }
      } catch {
        toast.error("Failed to load bin items");
      } finally {
        setLoadingBinItems((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
  };

  // ── Balance logic ───────────────────────────────────────────────────────────

  const toggleBalanceTeam = (teamId: number) => {
    setBalanceTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const selectAllTeamsForBalance = () => {
    setBalanceTeams(new Set(teamDetails.map((t) => t.id)));
  };

  const clearBalanceTeams = () => {
    setBalanceTeams(new Set());
  };

  const handleAutoBalance = async () => {
    const binsToBalance = unassignedBins; // already filtered by warehouse/brand
    if (binsToBalance.length === 0) {
      toast.error("No unassigned bins to distribute");
      return;
    }

    const targetTeams = teamDetails.filter((t) => balanceTeams.has(t.id));
    if (targetTeams.length === 0) {
      toast.error("Select at least one team");
      return;
    }

    const binCount = binsToBalance.length;
    const teamCount = targetTeams.length;
    const modeLabel = balanceMode === "equal-bins" ? "equal bins" : "equal items";
    if (!confirm(`Distribute ${binCount} bins across ${teamCount} teams (${modeLabel})?`)) return;

    setBalancing(true);
    try {
      // Sort bins naturally so physically adjacent bins stay together
      const sorted = [...binsToBalance].sort((a, b) => naturalCompare(a.bin_number, b.bin_number) || byWarehouse(a, b));

      // Build team trackers sorted by existing load (least loaded first)
      const teamTotals = targetTeams.map((t) => ({
        teamId: t.id,
        name: t.name,
        currentBins: t.bins.length,
        currentItems: t.itemCount,
        bins: [] as BinRef[],
      }));

      // Sort teams by current load so the least-loaded teams get bins first
      if (balanceMode === "equal-bins") {
        teamTotals.sort((a, b) => a.currentBins - b.currentBins);
      } else {
        teamTotals.sort((a, b) => a.currentItems - b.currentItems);
      }

      if (balanceMode === "equal-bins") {
        // Split sorted bins into contiguous chunks, one per team
        const totalBins = sorted.length;
        const n = teamTotals.length;
        let idx = 0;
        for (let t = 0; t < n; t++) {
          // Remaining teams get remaining bins split evenly
          const remaining = n - t;
          const chunkSize = Math.ceil((totalBins - idx) / remaining);
          for (let j = 0; j < chunkSize && idx < totalBins; j++, idx++) {
            teamTotals[t].bins.push(toBinRef(sorted[idx]));
          }
        }
      } else {
        // Split sorted bins into contiguous chunks targeting equal item counts
        const totalNewItems = sorted.reduce((s, b) => s + b.item_count, 0);
        const totalExistingItems = teamTotals.reduce((s, t) => s + t.currentItems, 0);
        const targetPerTeam = (totalNewItems + totalExistingItems) / teamTotals.length;
        let idx = 0;
        for (let t = 0; t < teamTotals.length; t++) {
          const isLast = t === teamTotals.length - 1;
          let runningItems = teamTotals[t].currentItems;
          while (idx < sorted.length) {
            if (!isLast && runningItems >= targetPerTeam && teamTotals[t].bins.length > 0) break;
            teamTotals[t].bins.push(toBinRef(sorted[idx]));
            runningItems += sorted[idx].item_count;
            teamTotals[t].currentItems += sorted[idx].item_count;
            idx++;
          }
        }
      }

      const assignments = teamTotals
        .filter((t) => t.bins.length > 0)
        .map((t) => ({ teamId: t.teamId, bins: t.bins }));

      const res = await fetch("/api/admin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eventId),
          action: "auto-balance",
          assignments,
          // Only the filtered brand's items are distributed
          ...(brandFilter ? { brand: brandFilter } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const summary = teamTotals
          .filter((t) => t.bins.length > 0)
          .map((t) => {
            const finalTotal = balanceMode === "equal-bins"
              ? t.currentBins + t.bins.length
              : t.currentItems;
            return `${t.name}: +${t.bins.length} bins (${finalTotal} total ${balanceMode === "equal-bins" ? "bins" : "items"})`;
          })
          .join(", ");
        toast.success(`Assigned ${data.assignedCount} items (${summary})`);
        setSelectedBins(new Set());
        setBalanceTeams(new Set());
        loadData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Auto-balance failed");
      }
    } catch {
      toast.error("Auto-balance failed");
    } finally {
      setBalancing(false);
    }
  };

  // ── Team bin selection (for bulk removal) ───────────────────────────────────

  const toggleTeamBin = (teamId: number, key: string) => {
    setSelectedTeamBins((prev) => {
      const teamSet = new Set(prev[teamId] || []);
      if (teamSet.has(key)) teamSet.delete(key);
      else teamSet.add(key);
      return { ...prev, [teamId]: teamSet };
    });
  };

  const toggleAllTeamBins = (teamId: number, bins: BinInfo[]) => {
    setSelectedTeamBins((prev) => {
      const teamSet = new Set(prev[teamId] || []);
      const allSelected = bins.every((b) => teamSet.has(binKey(b)));
      if (allSelected) {
        return { ...prev, [teamId]: new Set() };
      } else {
        return { ...prev, [teamId]: new Set(bins.map(binKey)) };
      }
    });
  };

  const selectFilteredTeamBins = (teamId: number, filteredBins: BinInfo[]) => {
    setSelectedTeamBins((prev) => ({
      ...prev,
      [teamId]: new Set(filteredBins.map(binKey)),
    }));
  };

  const clearTeamBinSelection = (teamId: number) => {
    setSelectedTeamBins((prev) => ({ ...prev, [teamId]: new Set() }));
  };

  const getSelectedTeamBinCount = (teamId: number) => {
    return selectedTeamBins[teamId]?.size || 0;
  };

  // DELETE /api/admin/assign; if the bins have counts (409), confirm and retry with clearCounts
  // Unassigning a whole team must say so explicitly with `all: true` (the server rejects
  // an empty/missing bins list so a bad request can't wipe a team by accident).
  const sendUnassign = async (payload: { teamId: number; bins: BinRef[] } | { teamId: number; all: true }): Promise<boolean> => {
    // With a brand filter active, removing bins only removes that brand's items (what is shown)
    const brand = "bins" in payload && brandFilter ? { brand: brandFilter } : {};
    const send = (clearCounts: boolean) =>
      fetch("/api/admin/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(eventId), ...payload, ...brand, ...(clearCounts ? { clearCounts: true } : {}) }),
      });
    let res = await send(false);
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      if (!data.hasCountedItems) {
        toast.error(data.error || "Failed to unassign");
        return false;
      }
      if (!confirm(`${data.countedCount} count(s) already recorded in these bins will be permanently deleted. Unassign anyway?`)) return false;
      res = await send(true);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to unassign");
      return false;
    }
    return true;
  };

  const handleBulkUnassign = async (teamId: number) => {
    const bins = getSelectedBinsForReassign(teamId);
    if (bins.length === 0) return;
    try {
      if (await sendUnassign({ teamId, bins })) {
        toast.success(`Removed ${bins.length} bin(s)`);
        setSelectedTeamBins((prev) => ({ ...prev, [teamId]: new Set() }));
        loadData();
      }
    } catch {
      toast.error("Failed to unassign");
    }
  };

  // ── Existing handlers ───────────────────────────────────────────────────────

  const handleAssign = async () => {
    if (!assignToTeam || selectedBins.size === 0) {
      toast.error("Select bins and a team");
      return;
    }
    setAssigning(true);
    try {
      const res = await fetch("/api/admin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eventId),
          teamId: Number(assignToTeam),
          bins: unassignedBins.filter((b) => selectedBins.has(binKey(b))).map(toBinRef),
          // Only the filtered brand's items in these bins are assigned
          ...(brandFilter ? { brand: brandFilter } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Assigned ${data.assignedCount} items`);
        setSelectedBins(new Set());
        setBinItemsCache({});
        setExpandedBins(new Set());
        loadData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Assignment failed");
      }
    } catch {
      toast.error("Assignment failed");
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignBins = async (teamId: number, bins: BinRef[]) => {
    try {
      if (await sendUnassign({ teamId, bins })) {
        toast.success(`Removed ${bins.length} bin(s)`);
        loadData();
      }
    } catch {
      toast.error("Failed to unassign");
    }
  };

  const handleUnassignAll = async (teamId: number) => {
    if (!confirm("Unassign ALL items from this team?")) return;
    try {
      if (await sendUnassign({ teamId, all: true })) {
        toast.success("All items unassigned");
        setSelectedTeamBins((prev) => ({ ...prev, [teamId]: new Set() }));
        loadData();
      }
    } catch {
      toast.error("Failed to unassign");
    }
  };

  const toggleTeamExpand = (teamId: number) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  // Selected bins of a team, in the team's bin order (re-assign and bulk removal use this)
  function getSelectedBinsForReassign(teamId: number): BinRef[] {
    const team = teamDetails.find(t => t.id === teamId);
    if (!team) return [];
    const selected = selectedTeamBins[teamId] || new Set<string>();
    return team.bins
      .filter(b => selected.has(binKey(b)))
      .map(toBinRef);
  }

  const hasCountedBinsInSelection = (teamId: number): boolean => {
    const team = teamDetails.find(t => t.id === teamId);
    if (!team) return false;
    const selected = selectedTeamBins[teamId] || new Set<string>();
    return team.bins.some(b => selected.has(binKey(b)) && (b.counted_items ?? 0) > 0);
  };

  const selectedItemCount = useMemo(() => {
    return unassignedBins
      .filter((b) => selectedBins.has(binKey(b)))
      .reduce((sum, b) => sum + b.item_count, 0);
  }, [unassignedBins, selectedBins]);

  const assignedPercent =
    stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0;

  return {
    eventId,
    // No event => nothing will load; don't leave callers stuck on "Loading..."
    loading: loading && !!eventId,
    loadData,
    unassignedBins,
    teamDetails,
    stats,
    assignedPercent,
    // unassigned bin selection / filters
    selectedBins,
    selectedItemCount,
    binSearch,
    setBinSearch,
    binSearchMode,
    setBinSearchMode,
    rangeFrom,
    setRangeFrom,
    rangeTo,
    setRangeTo,
    binSort,
    setBinSort,
    brandFilter,
    filterOptions,
    handleBrandFilterChange,
    groupedBins,
    toggleBin,
    selectGroup,
    selectAll,
    clearSelection,
    expandedBins,
    binItemsCache,
    loadingBinItems,
    toggleBinExpand,
    assignToTeam,
    setAssignToTeam,
    assigning,
    handleAssign,
    // teams
    expandedTeams,
    toggleTeamExpand,
    balanceTeams,
    balanceMode,
    setBalanceMode,
    balancing,
    toggleBalanceTeam,
    selectAllTeamsForBalance,
    clearBalanceTeams,
    handleAutoBalance,
    selectedTeamBins,
    toggleTeamBin,
    toggleAllTeamBins,
    selectFilteredTeamBins,
    clearTeamBinSelection,
    getSelectedTeamBinCount,
    getSelectedBinsForReassign,
    hasCountedBinsInSelection,
    handleBulkUnassign,
    handleUnassignBins,
    handleUnassignAll,
    resetForEventChange,
  };
}

export type AssignmentState = ReturnType<typeof useAssignment>;

export type AssignedBinSearchMode = "contains" | "starts" | "range";
export type AssignedCountedFilter = "all" | "counted" | "uncounted";

/**
 * Supervisor-only search/filter for the bins inside an expanded team
 * (shared across teams — reset whenever a team is expanded/collapsed).
 */
export function useAssignedBinFilters() {
  const [assignedBinSearch, setAssignedBinSearch] = useState("");
  const [assignedBinSearchMode, setAssignedBinSearchMode] = useState<AssignedBinSearchMode>("contains");
  const [assignedRangeFrom, setAssignedRangeFrom] = useState("");
  const [assignedRangeTo, setAssignedRangeTo] = useState("");
  const [assignedCountedFilter, setAssignedCountedFilter] = useState<AssignedCountedFilter>("all");

  const resetAssignedFilters = () => {
    setAssignedBinSearch("");
    setAssignedBinSearchMode("contains");
    setAssignedRangeFrom("");
    setAssignedRangeTo("");
    setAssignedCountedFilter("all");
  };

  return {
    assignedBinSearch,
    setAssignedBinSearch,
    assignedBinSearchMode,
    setAssignedBinSearchMode,
    assignedRangeFrom,
    setAssignedRangeFrom,
    assignedRangeTo,
    setAssignedRangeTo,
    assignedCountedFilter,
    setAssignedCountedFilter,
    resetAssignedFilters,
  };
}

export type AssignedBinFilters = ReturnType<typeof useAssignedBinFilters>;
