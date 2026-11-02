"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { CountItem } from "@/components/counting/item-card";
import type { AisleGroup } from "@/lib/bin-utils";
import { Search, ChevronDown, ChevronUp, PlayCircle, ClipboardCheck, ScanBarcode, Users, LayoutGrid, LayoutList, Layers } from "lucide-react";
import { AisleGroupedBins } from "./aisle-grouped-bins";
import {
  isMatchTrue,
  type BinStats,
  type BinTab,
  type BinVariant,
  type CompletedFilter,
  type CountStats,
  type SearchMode,
  type SerialVerificationTask,
  type VerificationItem,
} from "./types";

type BinStatEntry = [string, BinStats];

export interface BinSelectionViewProps {
  er: boolean;
  binViewMode: "grid" | "list";
  onToggleBinViewMode: () => void;
  userName: string | undefined;
  members: string[];
  stats: CountStats;
  items: CountItem[];
  verificationItems: VerificationItem[];
  serialVerificationTasks: SerialVerificationTask[];

  // Search
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  searchMode: SearchMode;
  setSearchMode: Dispatch<SetStateAction<SearchMode>>;
  searchCollapsed: boolean;
  setSearchCollapsed: Dispatch<SetStateAction<boolean>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchResults: CountItem[];

  // Resume banner
  resumeBin: { binName: string; remaining: number } | null;
  onResume: (binName: string) => void;

  // Tabs + filters
  binTab: BinTab;
  setBinTab: Dispatch<SetStateAction<BinTab>>;
  binStats: BinStatEntry[];
  notStartedBins: BinStatEntry[];
  inProgressBins: BinStatEntry[];
  completedBins: BinStatEntry[];
  filteredCompletedBins: BinStatEntry[];
  groupedNotStarted: AisleGroup[];
  groupedInProgress: AisleGroup[];
  groupedCompleted: AisleGroup[];
  completedFilter: CompletedFilter;
  setCompletedFilter: Dispatch<SetStateAction<CompletedFilter>>;
  serializedOnly: boolean;
  setSerializedOnly: Dispatch<SetStateAction<boolean>>;
  multiItemOnly: boolean;
  setMultiItemOnly: Dispatch<SetStateAction<boolean>>;

  // Aisles
  collapsedAisles: Set<string>;
  toggleAisle: (key: string) => void;
  expandAllAisles: (groups: AisleGroup[], variant: string) => void;
  collapseAllAisles: (groups: AisleGroup[], variant: string) => void;

  // Actions
  selectBin: (bin: string) => void;
  verificationBinStats: [string, { total: number; items: VerificationItem[] }][];
  startVerificationCounting: (bin: string) => void;
  onOpenSerialTask: (task: SerialVerificationTask) => void;
}

export function BinSelectionView(props: BinSelectionViewProps) {
  const {
    er,
    binViewMode,
    onToggleBinViewMode,
    userName,
    members,
    stats,
    items,
    verificationItems,
    serialVerificationTasks,
    search,
    setSearch,
    searchMode,
    setSearchMode,
    searchCollapsed,
    setSearchCollapsed,
    searchInputRef,
    searchResults,
    resumeBin,
    onResume,
    binTab,
    setBinTab,
    binStats,
    notStartedBins,
    inProgressBins,
    completedBins,
    filteredCompletedBins,
    groupedNotStarted,
    groupedInProgress,
    groupedCompleted,
    completedFilter,
    setCompletedFilter,
    serializedOnly,
    setSerializedOnly,
    multiItemOnly,
    setMultiItemOnly,
    collapsedAisles,
    toggleAisle,
    expandAllAisles,
    collapseAllAisles,
    selectBin,
    verificationBinStats,
    startVerificationCounting,
    onOpenSerialTask,
  } = props;

  if (items.length === 0 && verificationItems.length === 0 && serialVerificationTasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">
          No items assigned to your team
        </div>
      </div>
    );
  }

  const varianceBinCount = completedBins.filter(([, s]) => s.variances > 0).length;
  const isListMode = binViewMode === "list";
  const renderAisleGroupedBins = (groups: AisleGroup[], variant: BinVariant) => (
    <AisleGroupedBins
      groups={groups}
      variant={variant}
      er={er}
      isListMode={isListMode}
      collapsedAisles={collapsedAisles}
      toggleAisle={toggleAisle}
      selectBin={selectBin}
    />
  );

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Header: team info + progress + search */}
      <div className="p-4 space-y-3 border-b">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{userName}</span>
          {members.length > 0 && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" />
              {members.join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Progress value={stats.progressPercent} className={`${er ? "h-5" : "h-3"} flex-1`} />
          <span className={`${er ? "text-lg" : "text-sm"} font-semibold text-primary min-w-[3rem] text-right`}>
            {stats.progressPercent}%
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {stats.counted} of {stats.total} counted
          </span>
          {(() => {
            const matched = items.filter((i) => i.countId !== null && isMatchTrue(i.isMatch)).length;
            const withVariance = items.filter((i) => i.countId !== null && !isMatchTrue(i.isMatch)).length;
            const pending = items.filter((i) => i.countId === null).length;
            return (
              <>
                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">
                  ✓ {matched}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  ⚠ {withVariance}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">
                  ○ {pending}
                </span>
              </>
            );
          })()}
        </div>
        <button
          onClick={() => { setSearchCollapsed(!searchCollapsed); if (searchCollapsed) setTimeout(() => searchInputRef.current?.focus(), 100); }}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="font-medium">Search</span>
          {search && searchCollapsed && (
            <span className="text-primary text-xs truncate flex-1 text-left">&ldquo;{search}&rdquo;</span>
          )}
          <span className="ml-auto">
            {searchCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </span>
        </button>
        {!searchCollapsed && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  searchMode === "bin"
                    ? "Search by bin..."
                    : searchMode === "exact"
                      ? "Exact match..."
                      : searchMode === "starts"
                        ? "Starts with..."
                        : "Search by part code or description..."
                }
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5">
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
            </div>
          </>
        )}
      </div>

      {/* Resume banner */}
      {!search.trim() && resumeBin && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
          <PlayCircle className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Resume counting</div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono font-medium">{resumeBin.binName}</span>
              {" — "}{resumeBin.remaining} item{resumeBin.remaining !== 1 ? "s" : ""} remaining
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => onResume(resumeBin.binName)}
          >
            Resume
          </Button>
        </div>
      )}

      {/* Tabs (hidden during search) */}
      {!search.trim() && (
        <div className="border-b bg-muted/30">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h1 className={`${er ? "text-2xl" : "text-lg"} font-semibold`}>Select a Bin</h1>
            <button
              onClick={onToggleBinViewMode}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={binViewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
            >
              {binViewMode === "grid" ? <LayoutList className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
            {([
              ...(verificationItems.length > 0 || serialVerificationTasks.length > 0
                ? [{ key: "verification" as BinTab, label: "Verification", count: verificationItems.length + serialVerificationTasks.length }]
                : []),
              { key: "not-started" as BinTab, label: "Not Started", count: notStartedBins.length },
              { key: "in-progress" as BinTab, label: "In Progress", count: inProgressBins.length },
              { key: "completed" as BinTab, label: "Completed", count: completedBins.length },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setBinTab(tab.key)}
                className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  binTab === tab.key
                    ? tab.key === "verification"
                      ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                      : "bg-primary text-primary-foreground border-primary shadow-sm"
                    : tab.key === "verification"
                      ? "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
                      : "bg-white text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                {tab.key === "verification" && <ClipboardCheck className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />}
                {tab.label}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  binTab === tab.key
                    ? tab.key === "verification"
                      ? "bg-white/20 text-white"
                      : "bg-primary-foreground/20 text-primary-foreground"
                    : tab.key === "verification"
                      ? "bg-purple-200 text-purple-800"
                      : "bg-muted text-muted-foreground"
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {binStats.some(([, s]) => s.serialized > 0) && (
              <button
                onClick={() => setSerializedOnly((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  serializedOnly
                    ? "bg-purple-600 text-white"
                    : "bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                }`}
              >
                <ScanBarcode className="h-3 w-3" />
                Serialized only
              </button>
            )}
            <button
              onClick={() => setMultiItemOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                multiItemOnly
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              }`}
            >
              <Layers className="h-3 w-3" />
              Multi-item only
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Search results */}
        {search.trim() ? (
          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground mb-2">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
            </div>
            {searchResults.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                No items match &ldquo;{search}&rdquo;
              </div>
            )}
            {searchResults.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-2 text-sm border rounded-md"
              >
                <span className="font-mono font-medium text-xs w-28 flex-shrink-0 truncate">
                  {item.itemCode}
                </span>
                <span className="text-muted-foreground flex-1 truncate text-xs">
                  {item.description}
                </span>
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:bg-blue-50 text-xs flex-shrink-0"
                  onClick={() => selectBin(item.binNumber || "No Bin")}
                >
                  {item.binNumber || "No Bin"}
                </Badge>
                {item.countId !== null ? (
                  <Badge className="text-xs bg-green-100 text-green-800 border-green-300 flex-shrink-0">
                    Counted
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs flex-shrink-0">
                    Pending
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Verification tab */}
            {binTab === "verification" && (
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="text-sm font-medium text-purple-900 mb-0.5">
                    Verification Counts
                  </div>
                  <div className="text-xs text-purple-700">
                    Select a bin to verify. You will only see item details and on-hand — not the original count.
                  </div>
                </div>

                {verificationBinStats.length > 0 && (
                  <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {verificationBinStats.map(([bin, bStats]) => (
                      <button
                        key={bin}
                        className="text-left px-3 py-2.5 rounded-lg border border-purple-200 hover:border-purple-400 hover:shadow-sm transition-all bg-white"
                        onClick={() => startVerificationCounting(bin)}
                      >
                        <div className="font-mono font-bold text-sm truncate">{bin}</div>
                        <div className="text-[10px] text-purple-700 mt-1">
                          {bStats.total} item{bStats.total !== 1 ? "s" : ""} to verify
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Serial Verification Tasks */}
                {serialVerificationTasks.length > 0 && (
                  <>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="text-sm font-medium text-amber-900 mb-0.5">
                        Serial Verification
                      </div>
                      <div className="text-xs text-amber-700">
                        Physically verify unknown serial numbers. Mark each serial as present or not found.
                      </div>
                    </div>

                    <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                      {serialVerificationTasks.map((task) => (
                        <button
                          key={task.id}
                          className="text-left px-3 py-2.5 rounded-lg border border-amber-200 hover:border-amber-400 hover:shadow-sm transition-all bg-white"
                          onClick={() => onOpenSerialTask(task)}
                        >
                          <div className="font-mono font-bold text-sm truncate">{task.itemCode}</div>
                          {task.binNumber && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Bin: {task.binNumber}
                            </div>
                          )}
                          <div className="text-[10px] text-amber-700 mt-1">
                            {task.unknownSerials.length} serial{task.unknownSerials.length !== 1 ? "s" : ""} to verify
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Not Started tab */}
            {binTab === "not-started" && (
              <div className="space-y-1">
                {notStartedBins.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-12">
                    All bins have been started
                  </div>
                ) : (
                  <>
                    {groupedNotStarted.length > 1 && (
                      <div className="flex items-center justify-end gap-2 mb-2">
                        <button onClick={() => expandAllAisles(groupedNotStarted, "not-started")} className="text-xs text-primary hover:underline">Expand all</button>
                        <span className="text-muted-foreground text-xs">·</span>
                        <button onClick={() => collapseAllAisles(groupedNotStarted, "not-started")} className="text-xs text-primary hover:underline">Collapse all</button>
                      </div>
                    )}
                    {renderAisleGroupedBins(groupedNotStarted, "not-started")}
                  </>
                )}
              </div>
            )}

            {/* In Progress tab */}
            {binTab === "in-progress" && (
              <div className="space-y-1">
                {inProgressBins.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-12">
                    No bins in progress
                  </div>
                ) : (
                  <>
                    {groupedInProgress.length > 1 && (
                      <div className="flex items-center justify-end gap-2 mb-2">
                        <button onClick={() => expandAllAisles(groupedInProgress, "in-progress")} className="text-xs text-primary hover:underline">Expand all</button>
                        <span className="text-muted-foreground text-xs">·</span>
                        <button onClick={() => collapseAllAisles(groupedInProgress, "in-progress")} className="text-xs text-primary hover:underline">Collapse all</button>
                      </div>
                    )}
                    {renderAisleGroupedBins(groupedInProgress, "in-progress")}
                  </>
                )}
              </div>
            )}

            {/* Completed tab */}
            {binTab === "completed" && (
              <div className="space-y-3">
                {completedBins.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-12">
                    No bins completed yet
                  </div>
                ) : (
                  <>
                    {/* Filter bar */}
                    <div className="flex items-center gap-2">
                      {([
                        { key: "all" as const, label: "All" },
                        { key: "variances" as const, label: `Variances (${varianceBinCount})` },
                        { key: "matched" as const, label: "All Matched" },
                      ]).map((f) => (
                        <button
                          key={f.key}
                          onClick={() => setCompletedFilter(f.key)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                            completedFilter === f.key
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    {filteredCompletedBins.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-8">
                        No bins match this filter
                      </div>
                    ) : (
                      <>
                        {groupedCompleted.length > 1 && (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => expandAllAisles(groupedCompleted, "completed")} className="text-xs text-primary hover:underline">Expand all</button>
                            <span className="text-muted-foreground text-xs">·</span>
                            <button onClick={() => collapseAllAisles(groupedCompleted, "completed")} className="text-xs text-primary hover:underline">Collapse all</button>
                          </div>
                        )}
                        {renderAisleGroupedBins(groupedCompleted, "completed")}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
