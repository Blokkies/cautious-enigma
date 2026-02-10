"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

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

export default function AssignPage() {
  const [eventId, setEventId] = useState<string>("");
  const [unassignedBins, setUnassignedBins] = useState<BinInfo[]>([]);
  const [teamDetails, setTeamDetails] = useState<TeamDetail[]>([]);
  const [stats, setStats] = useState({ total: 0, assigned: 0, unassigned: 0 });
  const [loading, setLoading] = useState(true);

  // Bin selection
  const [selectedBins, setSelectedBins] = useState<Set<string>>(new Set());
  const [binSearch, setBinSearch] = useState("");
  const [assignToTeam, setAssignToTeam] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  // Team expand state
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());

  // Filters (Feature 3)
  const [warehouseFilter, setWarehouseFilter] = useState<string>("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [filterOptions, setFilterOptions] = useState<{ warehouses: string[]; brands: string[] }>({ warehouses: [], brands: [] });

  // Bin items expansion (Feature 4)
  const [expandedBins, setExpandedBins] = useState<Set<string>>(new Set());
  const [binItemsCache, setBinItemsCache] = useState<Record<string, BinItem[]>>({});
  const [loadingBinItems, setLoadingBinItems] = useState<Set<string>>(new Set());

  // Auto-balance (Feature 5)
  const [balancing, setBalancing] = useState(false);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      const ev = data.events?.find(
        (e: { status: string }) => e.status === "setup" || e.status === "active"
      );
      if (ev) setEventId(String(ev.id));
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!eventId) return;
    try {
      const params = new URLSearchParams({ eventId });
      if (warehouseFilter) params.set("warehouse", warehouseFilter);
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
  }, [eventId, warehouseFilter, brandFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group unassigned bins by prefix (e.g., "6A", "3B")
  const groupedBins = useMemo(() => {
    let filtered = unassignedBins;
    if (binSearch.trim()) {
      const q = binSearch.toLowerCase();
      filtered = unassignedBins.filter((b) =>
        b.bin_number.toLowerCase().includes(q)
      );
    }

    const groups: Record<string, BinInfo[]> = {};
    for (const bin of filtered) {
      // Extract prefix: everything before the first dot or first 2-3 chars
      const match = bin.bin_number.match(/^([A-Za-z0-9]+?)[\.\-\s]/);
      const prefix = match ? match[1] : bin.bin_number.substring(0, 2);
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(bin);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [unassignedBins, binSearch]);

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
    const filtered = binSearch.trim()
      ? unassignedBins.filter((b) =>
          b.bin_number.toLowerCase().includes(binSearch.toLowerCase())
        )
      : unassignedBins;
    setSelectedBins(new Set(filtered.map((b) => b.bin_number)));
  };

  const clearSelection = () => {
    setSelectedBins(new Set());
  };

  const handleFilterChange = (type: "warehouse" | "brand", value: string) => {
    const val = value === "__all__" ? "" : value;
    if (type === "warehouse") setWarehouseFilter(val);
    else setBrandFilter(val);
    setSelectedBins(new Set());
    setBinItemsCache({});
    setExpandedBins(new Set());
  };

  // Bin items expansion (Feature 4)
  const toggleBinExpand = async (binNumber: string) => {
    setExpandedBins((prev) => {
      const next = new Set(prev);
      if (next.has(binNumber)) {
        next.delete(binNumber);
      } else {
        next.add(binNumber);
      }
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

  // Auto-balance (Feature 5)
  const handleAutoBalance = async () => {
    if (unassignedBins.length === 0) {
      toast.error("No unassigned bins to distribute");
      return;
    }
    if (teamDetails.length === 0) {
      toast.error("No teams to assign to");
      return;
    }
    if (!confirm(`Auto-balance ${unassignedBins.length} unassigned bins across ${teamDetails.length} teams?`)) return;

    setBalancing(true);
    try {
      // Greedy algorithm: sort bins by item_count descending, assign each to team with lowest current total
      const sorted = [...unassignedBins].sort((a, b) => b.item_count - a.item_count);
      const teamTotals = teamDetails.map((t) => ({ teamId: t.id, name: t.name, total: t.itemCount, bins: [] as string[] }));

      for (const bin of sorted) {
        // Find team with lowest current total
        teamTotals.sort((a, b) => a.total - b.total);
        teamTotals[0].bins.push(bin.bin_number);
        teamTotals[0].total += bin.item_count;
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
        loadData();
      }
    } catch {
      toast.error("Auto-balance failed");
    } finally {
      setBalancing(false);
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

      {/* Team Assignments - expandable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Team Assignments</span>
            {teamDetails.length > 0 && unassignedBins.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoBalance}
                disabled={balancing}
                className="gap-1"
              >
                {balancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                Auto-Balance
              </Button>
            )}
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
              return (
                <div key={team.id} className="border rounded-lg">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                    onClick={() => toggleTeamExpand(team.id)}
                  >
                    <div className="flex items-center gap-2">
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
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        R
                        {team.totalValue.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </span>
                      {team.itemCount > 0 && (
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
                      {team.bins.map((bin) => (
                        <div
                          key={bin.bin_number}
                          className="flex items-center justify-between text-sm py-1"
                        >
                          <div className="flex items-center gap-2">
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
                            onClick={() =>
                              handleUnassignBins(team.id, [bin.bin_number])
                            }
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
        </CardContent>
      </Card>

      {/* Unassigned Bins */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>
              Unassigned Bins ({unassignedBins.length})
            </span>
            {selectedBins.size > 0 && (
              <Badge className="bg-blue-100 text-blue-800">
                {selectedBins.size} bins selected ({selectedItemCount} items)
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2">
            <Select value={warehouseFilter || "__all__"} onValueChange={(v) => handleFilterChange("warehouse", v)}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="All Warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Warehouses</SelectItem>
                {filterOptions.warehouses.map((w) => (
                  <SelectItem key={w} value={w}>{w}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={brandFilter || "__all__"} onValueChange={(v) => handleFilterChange("brand", v)}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Brands</SelectItem>
                {filterOptions.brands.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search + Select All */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search bins..."
                value={binSearch}
                onChange={(e) => setBinSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            {selectedBins.size > 0 && (
              <Button variant="destructive" size="sm" onClick={clearSelection}>
                Clear Selection
              </Button>
            )}
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
