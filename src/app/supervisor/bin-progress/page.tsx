"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  ChevronDown,
  ChevronRight,
  Search,
  Package,
  CheckCircle2,
  Clock,
  Minus,
  ArrowUpDown,
} from "lucide-react";

// ─── Natural compare ──────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface BinProgress {
  binNumber: string;
  totalItems: number;
  countedItems: number;
  isComplete: boolean;
}

interface TeamProgress {
  id: number;
  name: string;
  members: string | null;
  bins: BinProgress[];
  totalBins: number;
  completedBins: number;
}

type BinSortMode = "natural" | "alpha" | "items-desc" | "progress-desc";
type StatusFilter = "all" | "complete" | "in-progress" | "not-started";
type BinSearchMode = "contains" | "starts" | "exact";

export default function BinProgressPage() {
  const [teams, setTeams] = useState<TeamProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // New filter state
  const [brandFilter, setBrandFilter] = useState("");
  const [filterOptions, setFilterOptions] = useState<{ brands: string[] }>({ brands: [] });
  const [binSearch, setBinSearch] = useState("");
  const [binSearchMode, setBinSearchMode] = useState<BinSearchMode>("contains");
  const [binSort, setBinSort] = useState<BinSortMode>("natural");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (brandFilter) params.set("brand", brandFilter);
      const qs = params.toString();
      const res = await fetch(`/api/supervisor/bin-progress${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams || []);
        if (data.filterOptions) setFilterOptions(data.filterOptions);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [brandFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleTeam = (teamId: number) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleBrandFilterChange = (value: string) => {
    setBrandFilter(value === "__all__" ? "" : value);
  };

  // ─── Bin filtering helpers ────────────────────────────────────────────────
  const filterBinByStatus = useCallback((bin: BinProgress): boolean => {
    switch (statusFilter) {
      case "complete": return bin.isComplete;
      case "in-progress": return !bin.isComplete && bin.countedItems > 0;
      case "not-started": return bin.countedItems === 0;
      default: return true;
    }
  }, [statusFilter]);

  const filterBinBySearch = useCallback((bin: BinProgress): boolean => {
    if (!binSearch.trim()) return true;
    const q = binSearch.toLowerCase();
    const v = bin.binNumber.toLowerCase();
    switch (binSearchMode) {
      case "starts": return v.startsWith(q);
      case "exact": return v === q;
      case "contains":
      default: return v.includes(q);
    }
  }, [binSearch, binSearchMode]);

  const binComparator = useMemo(() => {
    switch (binSort) {
      case "natural":
        return (a: BinProgress, b: BinProgress) => naturalCompare(a.binNumber, b.binNumber);
      case "alpha":
        return (a: BinProgress, b: BinProgress) => a.binNumber.localeCompare(b.binNumber);
      case "items-desc":
        return (a: BinProgress, b: BinProgress) => b.totalItems - a.totalItems || naturalCompare(a.binNumber, b.binNumber);
      case "progress-desc":
        return (a: BinProgress, b: BinProgress) => {
          const pa = a.totalItems > 0 ? a.countedItems / a.totalItems : 0;
          const pb = b.totalItems > 0 ? b.countedItems / b.totalItems : 0;
          return pb - pa || naturalCompare(a.binNumber, b.binNumber);
        };
    }
  }, [binSort]);

  // ─── Apply status filter to teams ─────────────────────────────────────────
  const teamsWithFilteredBins = useMemo(() => {
    return teams.map(team => {
      const filtered = team.bins.filter(filterBinByStatus);
      return {
        ...team,
        bins: filtered,
        totalBins: filtered.length,
        completedBins: filtered.filter(b => b.isComplete).length,
      };
    }).filter(t => t.totalBins > 0 || statusFilter === "all");
  }, [teams, filterBinByStatus, statusFilter]);

  const filteredTeams = useMemo(() => {
    if (!search.trim()) return teamsWithFilteredBins;
    const q = search.toLowerCase();
    return teamsWithFilteredBins.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.members && t.members.toLowerCase().includes(q))
    );
  }, [teamsWithFilteredBins, search]);

  // ─── Overall stats (from filtered data) ───────────────────────────────────
  const totalBins = teamsWithFilteredBins.reduce((s, t) => s + t.totalBins, 0);
  const completedBins = teamsWithFilteredBins.reduce((s, t) => s + t.completedBins, 0);
  const overallPercent = totalBins > 0 ? Math.round((completedBins / totalBins) * 100) : 0;

  // ─── Group bins by prefix (for a single team) ────────────────────────────
  const getGroupedBins = useCallback((bins: BinProgress[]) => {
    const filtered = bins.filter(filterBinBySearch);
    const sorted = [...filtered].sort(binComparator);

    const groups: Record<string, BinProgress[]> = {};
    const groupOrder: string[] = [];
    for (const bin of sorted) {
      const match = bin.binNumber.match(/^([A-Za-z0-9]+?)[\.\-\s]/);
      const prefix = match ? match[1] : bin.binNumber.substring(0, 2);
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

    return groupOrder.map((prefix) => [prefix, groups[prefix]] as [string, BinProgress[]]);
  }, [filterBinBySearch, binComparator, binSort]);

  const parseMembers = (members: string | null): string => {
    if (!members) return "";
    try {
      const arr = JSON.parse(members) as string[];
      return arr.join(", ");
    } catch {
      return "";
    }
  };

  const renderBinRow = (bin: BinProgress) => {
    const binPercent = bin.totalItems > 0
      ? Math.round((bin.countedItems / bin.totalItems) * 100)
      : 0;

    let statusIcon;
    let statusColor;
    if (bin.isComplete) {
      statusIcon = <CheckCircle2 className="h-4 w-4 text-green-600" />;
      statusColor = "bg-green-50 border-green-200";
    } else if (bin.countedItems > 0) {
      statusIcon = <Clock className="h-4 w-4 text-amber-500" />;
      statusColor = "bg-amber-50 border-amber-200";
    } else {
      statusIcon = <Minus className="h-4 w-4 text-gray-400" />;
      statusColor = "bg-gray-50 border-gray-200";
    }

    return (
      <div
        key={bin.binNumber}
        className={`flex items-center justify-between px-3 py-2 rounded-lg border ${statusColor}`}
      >
        <div className="flex items-center gap-2">
          {statusIcon}
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm">{bin.binNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {bin.countedItems}/{bin.totalItems} items
          </span>
          <Badge
            variant="outline"
            className={
              bin.isComplete
                ? "bg-green-100 text-green-700 border-green-300"
                : bin.countedItems > 0
                  ? "bg-amber-100 text-amber-700 border-amber-300"
                  : "bg-gray-100 text-gray-500 border-gray-300"
            }
          >
            {binPercent}%
          </Badge>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Bin Progress</h1>

      {/* Overall stats */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Bin Completion</span>
            <span className="text-sm text-muted-foreground">
              {completedBins}/{totalBins} bins ({overallPercent}%)
            </span>
          </div>
          <Progress value={overallPercent} className="h-3 mb-2" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{filteredTeams.length} teams</span>
            <span>{totalBins} total bins</span>
            <span className="text-green-600">{completedBins} complete</span>
            <span className="text-amber-600">{totalBins - completedBins} remaining</span>
          </div>
        </CardContent>
      </Card>

      {/* Filters row: brand + team search */}
      <div className="flex gap-2">
        {filterOptions.brands.length > 1 && (
          <Select value={brandFilter || "__all__"} onValueChange={handleBrandFilterChange}>
            <SelectTrigger className="w-44">
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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground mr-1">Status:</span>
        {([
          { key: "all" as const, label: "All" },
          { key: "complete" as const, label: "Complete" },
          { key: "in-progress" as const, label: "In Progress" },
          { key: "not-started" as const, label: "Not Started" },
        ]).map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === s.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Team cards */}
      <div className="space-y-3">
        {filteredTeams.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {search ? "No teams match your search" : "No teams with assigned bins"}
          </div>
        ) : (
          filteredTeams.map((team) => {
            const isExpanded = expandedTeams.has(team.id);
            const percent = team.totalBins > 0
              ? Math.round((team.completedBins / team.totalBins) * 100)
              : 0;
            const membersStr = parseMembers(team.members);

            return (
              <Card key={team.id}>
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleTeam(team.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <span className="font-semibold">{team.name}</span>
                        {membersStr && (
                          <span className="text-sm text-muted-foreground ml-2">
                            ({membersStr})
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={percent === 100 ? "default" : "secondary"}
                      className={percent === 100 ? "bg-green-100 text-green-800" : ""}
                    >
                      {team.completedBins}/{team.totalBins} bins
                    </Badge>
                  </div>
                  <Progress value={percent} className="h-2" />
                  <div className="text-xs text-muted-foreground mt-1">
                    {percent}% complete
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="border-t pt-3 pb-3 space-y-3">
                    {team.bins.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        No bins assigned
                      </div>
                    ) : (
                      <>
                        {/* Bin search + mode pills + sort */}
                        <div className="space-y-2">
                          <div className="flex gap-2">
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
                                className="pl-9 h-8 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <Select value={binSort} onValueChange={(v) => setBinSort(v as BinSortMode)}>
                              <SelectTrigger className="w-36 h-8 text-sm" onClick={(e) => e.stopPropagation()}>
                                <ArrowUpDown className="h-3.5 w-3.5 mr-1 shrink-0" />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="natural">Natural</SelectItem>
                                <SelectItem value="alpha">Alphabetical</SelectItem>
                                <SelectItem value="items-desc">Most Items</SelectItem>
                                <SelectItem value="progress-desc">Progress</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground mr-1">Mode:</span>
                            {([
                              { key: "contains" as const, label: "Contains" },
                              { key: "starts" as const, label: "Starts with" },
                              { key: "exact" as const, label: "Exact" },
                            ]).map((m) => (
                              <button
                                key={m.key}
                                onClick={(e) => { e.stopPropagation(); setBinSearchMode(m.key); }}
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
                        </div>

                        {/* Grouped bins */}
                        <div className="space-y-1 max-h-72 overflow-y-auto">
                          {(() => {
                            const grouped = getGroupedBins(team.bins);
                            if (grouped.length === 0) {
                              return (
                                <div className="text-sm text-muted-foreground text-center py-2">
                                  No bins match filters
                                </div>
                              );
                            }
                            // If only one group, render bins flat
                            if (grouped.length === 1) {
                              return grouped[0][1].map(renderBinRow);
                            }
                            return grouped.map(([prefix, bins]) => {
                              const groupKey = `${team.id}-${prefix}`;
                              const isGroupExpanded = expandedGroups.has(groupKey);
                              const groupComplete = bins.filter(b => b.isComplete).length;
                              const groupPercent = bins.length > 0
                                ? Math.round((groupComplete / bins.length) * 100)
                                : 0;

                              return (
                                <div key={groupKey}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleGroup(groupKey); }}
                                    className="flex items-center justify-between w-full px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-sm"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      {isGroupExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                      )}
                                      <span className="font-mono font-medium">{prefix}</span>
                                      <span className="text-xs text-muted-foreground">
                                        ({bins.length} bin{bins.length !== 1 ? "s" : ""})
                                      </span>
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={
                                        groupPercent === 100
                                          ? "bg-green-100 text-green-700 border-green-300 text-xs"
                                          : groupPercent > 0
                                            ? "bg-amber-100 text-amber-700 border-amber-300 text-xs"
                                            : "bg-gray-100 text-gray-500 border-gray-300 text-xs"
                                      }
                                    >
                                      {groupComplete}/{bins.length} ({groupPercent}%)
                                    </Badge>
                                  </button>
                                  {isGroupExpanded && (
                                    <div className="ml-4 space-y-1 mt-1">
                                      {bins.map(renderBinRow)}
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
