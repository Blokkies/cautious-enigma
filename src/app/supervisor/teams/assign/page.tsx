"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  Package,
  Scale,
  Loader2,
  ArrowUpDown,
  ArrowLeft,
  X,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type BinSortMode = "natural" | "alpha" | "items-desc" | "value-desc";
type BalanceMode = "equal-bins" | "equal-items";

function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ax: (string | number)[] = [];
  const bx: (string | number)[] = [];

  let m;
  while ((m = re.exec(a)) !== null) {
    ax.push(m[1] ? parseInt(m[1], 10) : m[2]);
  }
  re.lastIndex = 0;
  while ((m = re.exec(b)) !== null) {
    bx.push(m[1] ? parseInt(m[1], 10) : m[2]);
  }

  const len = Math.min(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const ai = ax[i];
    const bi = bx[i];
    if (typeof ai === "number" && typeof bi === "number") {
      if (ai !== bi) return ai - bi;
    } else {
      const cmp = String(ai).localeCompare(String(bi), undefined, { sensitivity: "base" });
      if (cmp !== 0) return cmp;
    }
  }
  return ax.length - bx.length;
}

interface BinInfo {
  bin_number: string;
  item_count: number;
  total_value: number;
}

interface TeamDetail {
  id: number;
  name: string;
  member1: string | null;
  member2: string | null;
  itemCount: number;
  totalValue: number;
  bins: BinInfo[];
}

interface BinItem {
  id: number;
  item_code: string;
  description: string;
  brand: string;
  warehouse: string;
  on_hand: number;
  total_value: number;
  stock_status: string;
  serial_number: string;
}

export default function SupervisorAssignPage() {
  const { user } = useAuth();
  const eventId = String(user?.eventId || "");

  const [unassignedBins, setUnassignedBins] = useState<BinInfo[]>([]);
  const [teamDetails, setTeamDetails] = useState<TeamDetail[]>([]);
  const [stats, setStats] = useState({ total: 0, assigned: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);

  // Bin selection (unassigned)
  const [selectedBins, setSelectedBins] = useState<Set<string>>(new Set());
  const [binSearch, setBinSearch] = useState("");
  const [binSearchMode, setBinSearchMode] = useState<"contains" | "starts" | "exact" | "range">("contains");
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
    if (!eventId) return;
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
        return (a: BinInfo, b: BinInfo) => naturalCompare(a.bin_number, b.bin_number);
      case "alpha":
        return (a: BinInfo, b: BinInfo) => a.bin_number.localeCompare(b.bin_number);
      case "items-desc":
        return (a: BinInfo, b: BinInfo) => b.item_count - a.item_count || naturalCompare(a.bin_number, b.bin_number);
      case "value-desc":
        return (a: BinInfo, b: BinInfo) => b.total_value - a.total_value || naturalCompare(a.bin_number, b.bin_number);
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

  const toggleBin = (binNumber: string) => {
    setSelectedBins((prev) => {
      const next = new Set(prev);
      if (next.has(binNumber)) next.delete(binNumber);
      else next.add(binNumber);
      return next;
    });
  };

  const selectGroup = (bins: BinInfo[]) => {
    setSelectedBins((prev) => {
      const next = new Set(prev);
      const allSelected = bins.every((b) => next.has(b.bin_number));
      if (allSelected) {
        bins.forEach((b) => next.delete(b.bin_number));
      } else {
        bins.forEach((b) => next.add(b.bin_number));
      }
      return next;
    });
  };

  const selectAll = () => {
    const allFiltered = groupedBins.flatMap(([, bins]) => bins);
    setSelectedBins(new Set(allFiltered.map((b) => b.bin_number)));
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

  // Bin items expansion
  const toggleBinExpand = async (binNumber: string) => {
    setExpandedBins((prev) => {
      const next = new Set(prev);
      if (next.has(binNumber)) next.delete(binNumber);
      else next.add(binNumber);
      return next;
    });

    if (!binItemsCache[binNumber]) {
      setLoadingBinItems((prev) => new Set(prev).add(binNumber));
      try {
        const params = new URLSearchParams({ eventId, binNumber });
        const res = await fetch(`/api/admin/assign?${params}`);
        if (res.ok) {
          const data = await res.json();
          setBinItemsCache((prev) => ({ ...prev, [binNumber]: data.binItems || [] }));
        }
      } catch {
        toast.error("Failed to load bin items");
      } finally {
        setLoadingBinItems((prev) => {
          const next = new Set(prev);
          next.delete(binNumber);
          return next;
        });
      }
    }
  };

  // Balance logic
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
    const binsToBalance = unassignedBins;
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
      const sorted = [...binsToBalance].sort((a, b) => naturalCompare(a.bin_number, b.bin_number));

      const tCount = targetTeams.length;
      let teamTotals: { teamId: number; name: string; total: number; bins: string[] }[];

      if (balanceMode === "equal-bins") {
        const binsPerTeam = Math.ceil(sorted.length / tCount);
        teamTotals = targetTeams.map((t, i) => ({
          teamId: t.id,
          name: t.name,
          total: t.bins.length,
          bins: sorted.slice(i * binsPerTeam, (i + 1) * binsPerTeam).map((b) => b.bin_number),
        }));
      } else {
        const totalItems = sorted.reduce((s, b) => s + b.item_count, 0);
        const targetPerTeam = Math.ceil(totalItems / tCount);
        teamTotals = targetTeams.map((t) => ({
          teamId: t.id,
          name: t.name,
          total: t.itemCount,
          bins: [] as string[],
        }));

        let teamIdx = 0;
        let currentTotal = 0;
        for (const bin of sorted) {
          teamTotals[teamIdx].bins.push(bin.bin_number);
          teamTotals[teamIdx].total += bin.item_count;
          currentTotal += bin.item_count;
          if (currentTotal >= targetPerTeam && teamIdx < tCount - 1) {
            teamIdx++;
            currentTotal = 0;
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
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const summary = teamTotals
          .filter((t) => t.bins.length > 0)
          .map((t) => `${t.name}: ${t.bins.length} bins`)
          .join(", ");
        toast.success(`Assigned ${data.assignedCount} items (${summary})`);
        setSelectedBins(new Set());
        setBalanceTeams(new Set());
        loadData();
      }
    } catch {
      toast.error("Auto-balance failed");
    } finally {
      setBalancing(false);
    }
  };

  // Team bin selection (for bulk removal)
  const toggleTeamBin = (teamId: number, binNumber: string) => {
    setSelectedTeamBins((prev) => {
      const teamSet = new Set(prev[teamId] || []);
      if (teamSet.has(binNumber)) teamSet.delete(binNumber);
      else teamSet.add(binNumber);
      return { ...prev, [teamId]: teamSet };
    });
  };

  const toggleAllTeamBins = (teamId: number, bins: BinInfo[]) => {
    setSelectedTeamBins((prev) => {
      const teamSet = new Set(prev[teamId] || []);
      const allSelected = bins.every((b) => teamSet.has(b.bin_number));
      if (allSelected) {
        return { ...prev, [teamId]: new Set() };
      } else {
        return { ...prev, [teamId]: new Set(bins.map((b) => b.bin_number)) };
      }
    });
  };

  const getSelectedTeamBinCount = (teamId: number) => {
    return selectedTeamBins[teamId]?.size || 0;
  };

  const handleBulkUnassign = async (teamId: number) => {
    const bins = Array.from(selectedTeamBins[teamId] || []);
    if (bins.length === 0) return;
    try {
      const res = await fetch("/api/admin/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(eventId), teamId, bins }),
      });
      if (res.ok) {
        toast.success(`Removed ${bins.length} bin(s)`);
        setSelectedTeamBins((prev) => ({ ...prev, [teamId]: new Set() }));
        loadData();
      }
    } catch {
      toast.error("Failed to unassign");
    }
  };

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
          bins: Array.from(selectedBins),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Assigned ${data.assignedCount} items`);
        setSelectedBins(new Set());
        setBinItemsCache({});
        setExpandedBins(new Set());
        loadData();
      }
    } catch {
      toast.error("Assignment failed");
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignBins = async (teamId: number, bins: string[]) => {
    try {
      const res = await fetch("/api/admin/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(eventId), teamId, bins }),
      });
      if (res.ok) {
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
      const res = await fetch("/api/admin/assign", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(eventId), teamId }),
      });
      if (res.ok) {
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

  const selectedItemCount = useMemo(() => {
    return unassignedBins
      .filter((b) => selectedBins.has(b.bin_number))
      .reduce((sum, b) => sum + b.item_count, 0);
  }, [unassignedBins, selectedBins]);

  const assignedPercent =
    stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0;

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/supervisor/teams"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Teams
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Assign</span>
      </div>

      <h1 className="text-2xl font-bold">Assign Items to Teams</h1>

      {/* Progress */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Assignment Progress</span>
            <span className="text-sm text-muted-foreground">
              {stats.assigned.toLocaleString()}/{stats.total.toLocaleString()} (
              {assignedPercent}%)
            </span>
          </div>
          <Progress value={assignedPercent} className="h-3 mb-2" />
          {stats.unassigned > 0 && (
            <div className="flex items-center gap-1 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              {stats.unassigned.toLocaleString()} items unassigned
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team Assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Team Assignments</span>
            <div className="flex items-center gap-2">
              {balanceTeams.size > 0 && (
                <Button variant="ghost" size="sm" onClick={clearBalanceTeams} className="text-xs gap-1 h-7">
                  <X className="h-3 w-3" />
                  Clear
                </Button>
              )}
              {teamDetails.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => balanceTeams.size === teamDetails.length ? clearBalanceTeams() : selectAllTeamsForBalance()}
                  className="text-xs h-7"
                >
                  {balanceTeams.size === teamDetails.length ? "Deselect All" : "Select All"}
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {teamDetails.length === 0 ? (
            <div className="text-center text-muted-foreground py-4">
              No teams created yet
            </div>
          ) : (
            teamDetails.map((team) => {
              const isExpanded = expandedTeams.has(team.id);
              const isBalanceSelected = balanceTeams.has(team.id);
              const selectedCount = getSelectedTeamBinCount(team.id);
              const teamBinSet = selectedTeamBins[team.id] || new Set<string>();
              const allBinsSelected = team.bins.length > 0 && team.bins.every((b) => teamBinSet.has(b.bin_number));
              const someBinsSelected = team.bins.some((b) => teamBinSet.has(b.bin_number));

              return (
                <div key={team.id} className={`border rounded-lg ${isBalanceSelected ? "border-blue-300 bg-blue-50/30" : ""}`}>
                  <div className="flex items-center justify-between p-3 hover:bg-gray-50">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isBalanceSelected}
                        onChange={() => toggleBalanceTeam(team.id)}
                        className="rounded"
                        title="Include in auto-balance"
                      />
                      <div
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => toggleTeamExpand(team.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <span className="font-medium">{team.name}</span>
                          <span className="text-sm text-muted-foreground ml-2">
                            {team.itemCount.toLocaleString()} items
                          </span>
                          <span className="text-sm text-muted-foreground ml-2">
                            {team.bins.length} bins
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        R{team.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                      {selectedCount > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleBulkUnassign(team.id)}
                          className="h-7 text-xs gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove {selectedCount}
                        </Button>
                      )}
                      {team.bins.length > 0 && selectedCount === 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnassignAll(team.id);
                          }}
                          className="h-7 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {isExpanded && team.bins.length > 0 && (
                    <div className="border-t px-3 py-2 bg-gray-50 space-y-1 max-h-60 overflow-y-auto">
                      <div className="flex items-center justify-between pb-1 mb-1 border-b border-gray-200">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allBinsSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someBinsSelected && !allBinsSelected;
                            }}
                            onChange={() => toggleAllTeamBins(team.id, team.bins)}
                            className="rounded"
                          />
                          Select all {team.bins.length} bins
                        </label>
                      </div>
                      {team.bins.map((bin) => (
                        <div
                          key={bin.bin_number}
                          className="flex items-center justify-between text-sm py-1"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={teamBinSet.has(bin.bin_number)}
                              onChange={() => toggleTeamBin(team.id, bin.bin_number)}
                              className="rounded"
                            />
                            <Package className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono">{bin.bin_number}</span>
                            <span className="text-muted-foreground">
                              ({bin.item_count} items)
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleUnassignBins(team.id, [bin.bin_number])}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {isExpanded && team.bins.length === 0 && (
                    <div className="border-t px-3 py-3 bg-gray-50 text-sm text-muted-foreground text-center">
                      No bins assigned
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Balance toolbar */}
          {balanceTeams.size > 0 && unassignedBins.length > 0 && (
            <div className="border-t pt-3 mt-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  Auto-balance {unassignedBins.length} bins across {balanceTeams.size} team{balanceTeams.size !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <Select value={balanceMode} onValueChange={(v) => setBalanceMode(v as BalanceMode)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equal-bins">Equal Bins (balance by bin count)</SelectItem>
                    <SelectItem value="equal-items">Equal Items (balance by item count)</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAutoBalance}
                  disabled={balancing}
                  className="gap-1"
                >
                  {balancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                  {balancing ? "Balancing..." : "Balance"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {balanceMode === "equal-items"
                  ? "Assigns contiguous ranges of bins (natural sort order) so each team gets roughly the same item count. Adjacent bins stay together."
                  : "Assigns contiguous ranges of bins (natural sort order) split equally across teams. Adjacent bins stay together."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unassigned Bins */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-3">
            <span className="shrink-0">
              Unassigned Bins ({unassignedBins.length})
            </span>
            {selectedBins.size > 0 && (
              <Badge className="bg-blue-100 text-blue-800 shrink-0">
                {selectedBins.size} bins selected ({selectedItemCount} items)
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Brand Filter */}
          {filterOptions.brands.length > 1 && (
            <Select value={brandFilter || "__all__"} onValueChange={handleBrandFilterChange}>
              <SelectTrigger>
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Brands</SelectItem>
                {filterOptions.brands.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Search + Sort + Select All */}
          <div className="flex gap-2">
            {binSearchMode === "range" ? (
              <div className="flex gap-2 flex-1">
                <Input
                  placeholder="From (e.g. 200)"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="flex-1"
                />
                <span className="flex items-center text-muted-foreground text-sm">to</span>
                <Input
                  placeholder="To (e.g. 300)"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="flex-1"
                />
              </div>
            ) : (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    binSearchMode === "exact"
                      ? "Exact bin match..."
                      : binSearchMode === "starts"
                        ? "Bin starts with..."
                        : "Search bins..."
                  }
                  value={binSearch}
                  onChange={(e) => setBinSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            )}
            <Select value={binSort} onValueChange={(v) => setBinSort(v as BinSortMode)}>
              <SelectTrigger className="w-40">
                <ArrowUpDown className="h-3.5 w-3.5 mr-1 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="natural">Natural</SelectItem>
                <SelectItem value="alpha">Alphabetical</SelectItem>
                <SelectItem value="items-desc">Most Items</SelectItem>
                <SelectItem value="value-desc">Highest Value</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            {selectedBins.size > 0 && (
              <Button variant="destructive" size="sm" onClick={clearSelection}>
                Clear Selection
              </Button>
            )}
          </div>

          {/* Search mode pills */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Mode:</span>
            {([
              { key: "contains" as const, label: "Contains" },
              { key: "starts" as const, label: "Starts with" },
              { key: "exact" as const, label: "Exact" },
              { key: "range" as const, label: "Range" },
            ]).map((m) => (
              <button
                key={m.key}
                onClick={() => setBinSearchMode(m.key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  binSearchMode === m.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Grouped bins */}
          <div className="max-h-96 overflow-y-auto space-y-3 border rounded-lg p-2">
            {groupedBins.length === 0 ? (
              <div className="text-center text-muted-foreground py-6">
                {binSearch
                  ? "No bins match your search"
                  : "All bins have been assigned!"}
              </div>
            ) : (
              groupedBins.map(([prefix, bins]) => {
                const allSelected = bins.every((b) =>
                  selectedBins.has(b.bin_number)
                );
                const someSelected = bins.some((b) =>
                  selectedBins.has(b.bin_number)
                );
                const groupItemCount = bins.reduce(
                  (s, b) => s + b.item_count,
                  0
                );

                return (
                  <div key={prefix}>
                    {/* Group header */}
                    <div
                      className="flex items-center justify-between px-2 py-1.5 bg-gray-100 rounded cursor-pointer hover:bg-gray-200"
                      onClick={() => selectGroup(bins)}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el)
                              el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={() => selectGroup(bins)}
                          className="rounded"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="font-semibold text-sm">{prefix}</span>
                        <span className="text-xs text-muted-foreground">
                          {bins.length} bins, {groupItemCount} items
                        </span>
                      </div>
                    </div>

                    {/* Individual bins */}
                    <div className="ml-6 space-y-0.5 mt-1">
                      {bins.map((bin) => (
                        <div key={bin.bin_number}>
                          <div className="flex items-center justify-between py-0.5 px-2 rounded hover:bg-gray-50 text-sm">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedBins.has(bin.bin_number)}
                                onChange={() => toggleBin(bin.bin_number)}
                                className="rounded"
                              />
                              <button
                                type="button"
                                onClick={() => toggleBinExpand(bin.bin_number)}
                                className="flex items-center gap-1 hover:text-blue-600"
                              >
                                {expandedBins.has(bin.bin_number) ? (
                                  <ChevronDown className="h-3 w-3" />
                                ) : (
                                  <ChevronRight className="h-3 w-3" />
                                )}
                                <span className="font-mono text-xs">
                                  {bin.bin_number}
                                </span>
                              </button>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {bin.item_count} items
                            </span>
                          </div>
                          {expandedBins.has(bin.bin_number) && (
                            <div className="ml-10 mb-1 border-l-2 border-gray-200 pl-2">
                              {loadingBinItems.has(bin.bin_number) ? (
                                <div className="text-xs text-muted-foreground py-1 flex items-center gap-1">
                                  <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                                </div>
                              ) : binItemsCache[bin.bin_number]?.length ? (
                                binItemsCache[bin.bin_number].map((item) => (
                                  <div key={item.id} className="text-xs py-0.5 flex items-center justify-between text-muted-foreground">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-mono shrink-0">{item.item_code}</span>
                                      <span className="truncate max-w-[200px]">{item.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                      <span>qty: {item.on_hand}</span>
                                      <span>R{item.total_value?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '0'}</span>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="text-xs text-muted-foreground py-1">No items</div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Assign controls */}
          {selectedBins.size > 0 && (
            <div className="flex gap-2 pt-2 border-t">
              <Select value={assignToTeam} onValueChange={setAssignToTeam}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Assign to team..." />
                </SelectTrigger>
                <SelectContent>
                  {teamDetails.map((team) => (
                    <SelectItem key={team.id} value={String(team.id)}>
                      {team.name} ({team.itemCount} items)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAssign}
                disabled={assigning || !assignToTeam}
                className="gap-1"
              >
                <CheckCircle2 className="h-4 w-4" />
                {assigning
                  ? "Assigning..."
                  : `Assign ${selectedBins.size} bins`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
