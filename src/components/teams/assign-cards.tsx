"use client";

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
  X,
  ArrowRightLeft,
  Lock,
} from "lucide-react";
import { binKey, naturalCompare, toBinRef, type BalanceMode, type BinSortMode, type TeamDetail } from "./assign-types";
import type { AssignedBinFilters, AssignmentState } from "./use-assignment";
import type { ReassignState } from "./reassign-dialog";

/** Warehouse of a bin: bins with the same number in different warehouses are different bins. */
function WarehouseTag({ warehouse }: { warehouse: string | null }) {
  if (!warehouse) return null;
  return (
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1 leading-4">
      {warehouse}
    </span>
  );
}

export function AssignProgressCard({ assign }: { assign: AssignmentState }) {
  const { stats, assignedPercent } = assign;
  return (
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
  );
}

interface TeamAssignmentsCardProps {
  assign: AssignmentState;
  /** Auditors: hide every control that changes assignments. */
  readOnly?: boolean;
  /**
   * Supervisor view: per-team search/status filters, counted badges and re-assign.
   * When omitted (admin view) the expanded team shows a plain bin list.
   */
  filters?: AssignedBinFilters;
  reassign?: ReassignState;
}

export function TeamAssignmentsCard({ assign, readOnly = false, filters, reassign }: TeamAssignmentsCardProps) {
  const {
    teamDetails,
    unassignedBins,
    expandedTeams,
    balanceTeams,
    balanceMode,
    setBalanceMode,
    balancing,
    selectedTeamBins,
    toggleTeamExpand,
    toggleBalanceTeam,
    selectAllTeamsForBalance,
    clearBalanceTeams,
    handleAutoBalance,
    getSelectedTeamBinCount,
    getSelectedBinsForReassign,
    hasCountedBinsInSelection,
    handleBulkUnassign,
    handleUnassignAll,
  } = assign;

  const onToggleTeamExpand = (teamId: number) => {
    toggleTeamExpand(teamId);
    filters?.resetAssignedFilters();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Team Assignments</span>
          {!readOnly && (
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
            const isBalanceSelected = balanceTeams.has(team.id);
            const selectedCount = getSelectedTeamBinCount(team.id);
            const teamBinSet = selectedTeamBins[team.id] || new Set<string>();
            const allBinsSelected = team.bins.length > 0 && team.bins.every((b) => teamBinSet.has(binKey(b)));
            const someBinsSelected = team.bins.some((b) => teamBinSet.has(binKey(b)));

            return (
              <div key={team.id} className={`border rounded-lg ${isBalanceSelected ? "border-blue-300 bg-blue-50/30" : ""}`}>
                <div className="flex items-center justify-between p-3 hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    {/* Balance selection checkbox */}
                    {!readOnly && (
                      <input
                        type="checkbox"
                        checked={isBalanceSelected}
                        onChange={() => toggleBalanceTeam(team.id)}
                        className="rounded"
                        title="Include in auto-balance"
                      />
                    )}
                    <div
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => onToggleTeamExpand(team.id)}
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
                    {!readOnly && selectedCount > 0 && (
                      <>
                        {reassign && getSelectedBinsForReassign(team.id).length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              reassign.openReassign({ fromTeamId: team.id, bins: getSelectedBinsForReassign(team.id), hasCountedBins: hasCountedBinsInSelection(team.id) });
                            }}
                            className="h-7 text-xs gap-1 text-blue-600 border-blue-300 hover:bg-blue-50"
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            Re-assign {getSelectedBinsForReassign(team.id).length}
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleBulkUnassign(team.id)}
                          className="h-7 text-xs gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove {selectedCount}
                        </Button>
                      </>
                    )}
                    {!readOnly && team.bins.length > 0 && selectedCount === 0 && (
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
                  filters ? (
                    <FilterableTeamBinList
                      assign={assign}
                      team={team}
                      teamBinSet={teamBinSet}
                      allBinsSelected={allBinsSelected}
                      someBinsSelected={someBinsSelected}
                      readOnly={readOnly}
                      filters={filters}
                      reassign={reassign}
                    />
                  ) : (
                    <SimpleTeamBinList
                      assign={assign}
                      team={team}
                      teamBinSet={teamBinSet}
                      allBinsSelected={allBinsSelected}
                      someBinsSelected={someBinsSelected}
                    />
                  )
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
        {!readOnly && balanceTeams.size > 0 && unassignedBins.length > 0 && (
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
  );
}

interface TeamBinListProps {
  assign: AssignmentState;
  team: TeamDetail;
  teamBinSet: Set<string>;
  allBinsSelected: boolean;
  someBinsSelected: boolean;
}

/** Admin view: every assigned bin with a checkbox and a Remove button. */
function SimpleTeamBinList({ assign, team, teamBinSet, allBinsSelected, someBinsSelected }: TeamBinListProps) {
  const { toggleAllTeamBins, toggleTeamBin, handleUnassignBins } = assign;
  return (
    <div className="border-t px-3 py-2 bg-gray-50 space-y-1 max-h-60 overflow-y-auto">
      {/* Select all bins in team */}
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
          key={binKey(bin)}
          className="flex items-center justify-between text-sm py-1"
        >
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={teamBinSet.has(binKey(bin))}
              onChange={() => toggleTeamBin(team.id, binKey(bin))}
              className="rounded"
            />
            <Package className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono">{bin.bin_number}</span>
            <WarehouseTag warehouse={bin.warehouse} />
            <span className="text-muted-foreground">
              ({bin.item_count} items)
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            onClick={() => handleUnassignBins(team.id, [toBinRef(bin)])}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Supervisor view: assigned bins with search/status filters, counted badges and re-assign. */
function FilterableTeamBinList({
  assign,
  team,
  teamBinSet,
  allBinsSelected,
  someBinsSelected,
  readOnly,
  filters,
  reassign,
}: TeamBinListProps & { readOnly: boolean; filters: AssignedBinFilters; reassign?: ReassignState }) {
  const { toggleAllTeamBins, toggleTeamBin, selectFilteredTeamBins, clearTeamBinSelection, handleUnassignBins } = assign;
  const {
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
  } = filters;

  // Filter pipeline: search mode → counted status → sort
  let filtered = [...team.bins];

  // 1. Search mode filter
  if (assignedBinSearchMode === "range") {
    const from = assignedRangeFrom.trim().toLowerCase();
    const to = assignedRangeTo.trim().toLowerCase();
    if (from || to) {
      filtered = filtered.filter((b) => {
        const v = b.bin_number.toLowerCase();
        if (from && to) return naturalCompare(v, from) >= 0 && naturalCompare(v, to) <= 0;
        if (from) return naturalCompare(v, from) >= 0;
        return naturalCompare(v, to) <= 0;
      });
    }
  } else if (assignedBinSearch.trim()) {
    const q = assignedBinSearch.toLowerCase();
    filtered = filtered.filter((b) => {
      const v = b.bin_number.toLowerCase();
      return assignedBinSearchMode === "starts" ? v.startsWith(q) : v.includes(q);
    });
  }

  // 2. Counted status filter
  if (assignedCountedFilter === "counted") {
    filtered = filtered.filter((b) => (b.counted_items ?? 0) > 0);
  } else if (assignedCountedFilter === "uncounted") {
    filtered = filtered.filter((b) => (b.counted_items ?? 0) === 0);
  }

  const visibleBins = filtered.sort((a, b) => naturalCompare(a.bin_number, b.bin_number));
  const hasActiveFilter =
    assignedBinSearch.trim() !== "" ||
    assignedBinSearchMode === "range" && (assignedRangeFrom.trim() !== "" || assignedRangeTo.trim() !== "") ||
    assignedCountedFilter !== "all";
  const filteredDiffers = hasActiveFilter && visibleBins.length !== team.bins.length;

  return (
    <div className="border-t px-3 py-2 bg-gray-50 space-y-1">
      {/* Row 1: Search mode pills + counted status pills */}
      {team.bins.length > 5 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-0.5">Search:</span>
            {([
              { key: "contains" as const, label: "Contains" },
              { key: "starts" as const, label: "Starts with" },
              { key: "range" as const, label: "Range" },
            ]).map((m) => (
              <button
                key={m.key}
                onClick={() => { setAssignedBinSearchMode(m.key); setAssignedBinSearch(""); setAssignedRangeFrom(""); setAssignedRangeTo(""); }}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  assignedBinSearchMode === m.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-0.5">Status:</span>
            {([
              { key: "all" as const, label: "All" },
              { key: "uncounted" as const, label: "Uncounted" },
              { key: "counted" as const, label: "Counted" },
            ]).map((m) => (
              <button
                key={m.key}
                onClick={() => setAssignedCountedFilter(m.key)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  assignedCountedFilter === m.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Row 2: Search input or range inputs */}
      {team.bins.length > 5 && (
        assignedBinSearchMode === "range" ? (
          <div className="flex gap-1.5 items-center">
            <Input
              placeholder="From"
              value={assignedRangeFrom}
              onChange={(e) => setAssignedRangeFrom(e.target.value)}
              className="h-7 text-xs flex-1"
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-[10px] text-muted-foreground">to</span>
            <Input
              placeholder="To"
              value={assignedRangeTo}
              onChange={(e) => setAssignedRangeTo(e.target.value)}
              className="h-7 text-xs flex-1"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={assignedBinSearchMode === "starts" ? "Bin starts with..." : "Filter assigned bins..."}
              value={assignedBinSearch}
              onChange={(e) => setAssignedBinSearch(e.target.value)}
              className="pl-8 h-7 text-xs"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )
      )}

      {/* Row 3: Selection toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-2 pb-1 mb-1 border-b border-gray-200 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allBinsSelected}
              ref={(el) => {
                if (el) el.indeterminate = someBinsSelected && !allBinsSelected;
              }}
              onChange={() => toggleAllTeamBins(team.id, team.bins)}
              className="rounded"
            />
            Select all {team.bins.length}
          </label>
          {filteredDiffers && visibleBins.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-5 px-2 text-[10px] gap-1"
              onClick={() => selectFilteredTeamBins(team.id, visibleBins)}
            >
              Select filtered ({visibleBins.length})
            </Button>
          )}
          {someBinsSelected && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-[10px] text-muted-foreground"
              onClick={() => clearTeamBinSelection(team.id)}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      <div className="max-h-60 overflow-y-auto space-y-1">
      {visibleBins.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-2">No bins match filter</div>
      ) : visibleBins.map((bin) => {
        const isCounted = (bin.counted_items ?? 0) > 0;
        return (
          <div
            key={binKey(bin)}
            className="flex items-center justify-between text-sm py-1"
          >
            <div className="flex items-center gap-2">
              {!readOnly && (
                <input
                  type="checkbox"
                  checked={teamBinSet.has(binKey(bin))}
                  onChange={() => toggleTeamBin(team.id, binKey(bin))}
                  className="rounded"
                />
              )}
              <Package className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{bin.bin_number}</span>
            <WarehouseTag warehouse={bin.warehouse} />
              <span className="text-muted-foreground">
                ({bin.item_count} items)
              </span>
              {isCounted && (
                <Badge variant="outline" className="h-5 text-[10px] bg-green-50 text-green-700 border-green-300 gap-0.5">
                  <Lock className="h-2.5 w-2.5" />
                  Counted
                </Badge>
              )}
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1">
                {reassign && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    onClick={() => {
                      reassign.openReassign({ fromTeamId: team.id, bins: [toBinRef(bin)], hasCountedBins: isCounted });
                    }}
                    title="Re-assign to another team"
                  >
                    <ArrowRightLeft className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => handleUnassignBins(team.id, [toBinRef(bin)])}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

export function UnassignedBinsCard({ assign, readOnly = false }: { assign: AssignmentState; readOnly?: boolean }) {
  const {
    unassignedBins,
    teamDetails,
    selectedBins,
    selectedItemCount,
    filterOptions,
    brandFilter,
    handleBrandFilterChange,
    binSearchMode,
    setBinSearchMode,
    binSearch,
    setBinSearch,
    rangeFrom,
    setRangeFrom,
    rangeTo,
    setRangeTo,
    binSort,
    setBinSort,
    selectAll,
    clearSelection,
    groupedBins,
    selectGroup,
    toggleBin,
    expandedBins,
    toggleBinExpand,
    loadingBinItems,
    binItemsCache,
    assignToTeam,
    setAssignToTeam,
    assigning,
    handleAssign,
  } = assign;

  return (
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
          {!readOnly && (
            <>
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              {selectedBins.size > 0 && (
                <Button variant="destructive" size="sm" onClick={clearSelection}>
                  Clear Selection
                </Button>
              )}
            </>
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
                selectedBins.has(binKey(b))
              );
              const someSelected = bins.some((b) =>
                selectedBins.has(binKey(b))
              );
              const groupItemCount = bins.reduce(
                (s, b) => s + b.item_count,
                0
              );

              return (
                <div key={prefix}>
                  {/* Group header */}
                  <div
                    className={`flex items-center justify-between px-2 py-1.5 bg-gray-100 rounded ${!readOnly ? "cursor-pointer hover:bg-gray-200" : ""}`}
                    onClick={!readOnly ? () => selectGroup(bins) : undefined}
                  >
                    <div className="flex items-center gap-2">
                      {!readOnly && (
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
                      )}
                      <span className="font-semibold text-sm">{prefix}</span>
                      <span className="text-xs text-muted-foreground">
                        {bins.length} bins, {groupItemCount} items
                      </span>
                    </div>
                  </div>

                  {/* Individual bins */}
                  <div className="ml-6 space-y-0.5 mt-1">
                    {bins.map((bin) => (
                      <div key={binKey(bin)}>
                        <div className="flex items-center justify-between py-0.5 px-2 rounded hover:bg-gray-50 text-sm">
                          <div className="flex items-center gap-2">
                            {!readOnly && (
                              <input
                                type="checkbox"
                                checked={selectedBins.has(binKey(bin))}
                                onChange={() => toggleBin(binKey(bin))}
                                className="rounded"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => toggleBinExpand(bin)}
                              className="flex items-center gap-1 hover:text-blue-600"
                            >
                              {expandedBins.has(binKey(bin)) ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                              <span className="font-mono text-xs">
                                {bin.bin_number}
                              </span>
                            </button>
                            <WarehouseTag warehouse={bin.warehouse} />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {bin.item_count} items
                          </span>
                        </div>
                        {expandedBins.has(binKey(bin)) && (
                          <div className="ml-10 mb-1 border-l-2 border-gray-200 pl-2">
                            {loadingBinItems.has(binKey(bin)) ? (
                              <div className="text-xs text-muted-foreground py-1 flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                              </div>
                            ) : binItemsCache[binKey(bin)]?.length ? (
                              binItemsCache[binKey(bin)].map((item) => (
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
        {!readOnly && selectedBins.size > 0 && (
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
  );
}
