"use client";

import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ClipboardCheck, Check } from "lucide-react";
import { selectedVarianceValue, type EventOption, type VarianceItem, type VarianceSearchMode } from "./types";
import type { VarianceStats } from "./use-variances-data";
import type { VarianceSelection } from "./use-variance-actions";

/** Executive event picker + title with review badges + over/under/net/total value badges. */
export function VariancesHeader({
  isExecutive,
  execEvents,
  execEventId,
  onExecEventChange,
  activeVariances,
  activeTab,
  stats,
}: {
  isExecutive: boolean;
  execEvents: EventOption[];
  execEventId: number;
  onExecEventChange: (eventId: number) => void;
  activeVariances: VarianceItem[];
  activeTab: string;
  /** Stats for the active or accepted tab (whichever is showing). */
  stats: VarianceStats;
}) {
  // Summary counts for header badges
  const needReviewCount = activeVariances.filter(
    (v) => v.verificationStatus === "completed"
  ).length;
  const pendingVerificationCount = activeVariances.filter(
    (v) => v.verificationStatus === "pending"
  ).length;
  const unassignedCount = activeVariances.filter(
    (v) => !v.verificationId || v.verificationStatus === "accepted"
  ).length;

  return (
    <>
      {/* Executive event picker */}
      {isExecutive && execEvents.length > 1 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Event:</label>
          <select
            value={execEventId}
            onChange={(e) => onExecEventChange(Number(e.target.value))}
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {execEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name} ({ev.status})</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">Variances</h1>
          {needReviewCount > 0 && (
            <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs">
              {needReviewCount} need review
            </Badge>
          )}
          {pendingVerificationCount > 0 && (
            <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
              {pendingVerificationCount} pending verification
            </Badge>
          )}
          {unassignedCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unassignedCount} unassigned
            </Badge>
          )}
        </div>
        {activeTab !== "resolved" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
              {stats.overCount} over R{stats.overValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Badge>
            <span className="text-muted-foreground text-xs">·</span>
            <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">
              {stats.underCount} under R{stats.underValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Badge>
            <span className="text-muted-foreground text-xs">·</span>
            <Badge className={`text-xs ${stats.netVarianceValue >= 0 ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}`}>
              Net: {stats.netVarianceValue >= 0 ? "" : "-"}R{Math.abs(stats.netVarianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Badge>
            <span className="text-muted-foreground text-xs">·</span>
            <Badge variant="destructive" className="text-xs">
              R{stats.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} total
            </Badge>
          </div>
        )}
      </div>
    </>
  );
}

/** Search box + search-mode pills + "Serials" filter toggle. */
export function VarianceSearchBar({
  search,
  setSearch,
  searchMode,
  setSearchMode,
  serialFilter,
  setSerialFilter,
  unknownSerialCount,
}: {
  search: string;
  setSearch: (v: string) => void;
  searchMode: VarianceSearchMode;
  setSearchMode: (m: VarianceSearchMode) => void;
  serialFilter: boolean;
  setSerialFilter: Dispatch<SetStateAction<boolean>>;
  unknownSerialCount: number;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={
            searchMode === "bin"
              ? "Search by bin..."
              : searchMode === "exact"
                ? "Exact match..."
                : searchMode === "starts"
                  ? "Starts with..."
                  : "Search variances..."
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Mode:</span>
        {([
          { key: "contains" as const, label: "Contains" },
          { key: "starts" as const, label: "Starts with" },
          { key: "exact" as const, label: "Exact" },
          { key: "bin" as const, label: "Bin" },
        ]).map((m) => (
          <button
            key={m.key}
            onClick={() => setSearchMode(m.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              searchMode === m.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {m.label}
          </button>
        ))}
        <div className="h-4 w-px bg-border mx-1" />
        <button
          onClick={() => setSerialFilter((v) => !v)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1 ${
            serialFilter
              ? "bg-amber-500 text-white"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Serials
          {unknownSerialCount > 0 && (
            <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold ${
              serialFilter ? "bg-white/30 text-white" : "bg-amber-100 text-amber-800"
            }`}>
              {unknownSerialCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

/** Active-tab selection toolbar: select all, value threshold, assign verification, bulk accept. */
export function SelectionToolbar({
  selection,
  activeVariances,
  filterItems,
}: {
  selection: VarianceSelection;
  activeVariances: VarianceItem[];
  filterItems: (items: VarianceItem[]) => VarianceItem[];
}) {
  const {
    selectedCountIds,
    setSelectedCountIds,
    selectableItems,
    toggleSelectAll,
    thresholdValue,
    setThresholdValue,
    thresholdMode,
    setThresholdMode,
    selectByThreshold,
    openAssignDialog,
    setShowBulkAcceptDialog,
  } = selection;

  return (
    <div className="bg-muted/30 rounded-lg p-2 mb-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleSelectAll}
          className="text-xs"
        >
          {selectedCountIds.size === filterItems(selectableItems).length &&
          filterItems(selectableItems).length > 0
            ? "Deselect All"
            : `Select All (${filterItems(selectableItems).length})`}
        </Button>

        <div className="h-4 w-px bg-border" />

        {/* Value threshold selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">R</span>
          <Input
            type="number"
            inputMode="decimal"
            value={thresholdValue}
            onChange={(e) => setThresholdValue(e.target.value)}
            placeholder="0"
            className="h-7 w-20 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") selectByThreshold();
            }}
          />
          <div className="flex">
            <button
              onClick={() => setThresholdMode("gte")}
              className={`px-2 py-1 text-xs font-medium rounded-l-md border transition-colors ${
                thresholdMode === "gte"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              &ge;
            </button>
            <button
              onClick={() => setThresholdMode("lte")}
              className={`px-2 py-1 text-xs font-medium rounded-r-md border-t border-r border-b transition-colors ${
                thresholdMode === "lte"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              &le;
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={selectByThreshold}
            disabled={!thresholdValue}
          >
            Select
          </Button>
        </div>

        {selectedCountIds.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 text-muted-foreground"
            onClick={() => setSelectedCountIds(new Set())}
          >
            Clear
          </Button>
        )}
      </div>

      {selectedCountIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
          <span className="text-sm font-medium">
            {selectedCountIds.size} selected
            <span className="text-muted-foreground font-normal ml-1">
              (R{selectedVarianceValue(activeVariances, selectedCountIds)} total value)
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={openAssignDialog}
              className="text-xs"
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
              Assign Verification
            </Button>
            <Button
              size="sm"
              onClick={() => setShowBulkAcceptDialog(true)}
              className="text-xs bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Accept Selected
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
