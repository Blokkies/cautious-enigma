"use client";

import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { AisleGroup } from "@/lib/bin-utils";
import type { BinStats, BinVariant } from "./types";

/** SVG circular progress indicator */
function CircularProgress({ percent, size = 28 }: { percent: number; size?: number }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-gray-200" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-blue-500" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-current text-muted-foreground" style={{ fontSize: "8px" }}>
        {percent}%
      </text>
    </svg>
  );
}

function renderBinButton(bin: string, bStats: BinStats, variant: BinVariant, er: boolean, selectBin: (bin: string) => void) {
  const hasSerialized = bStats.serialized > 0;

  if (variant === "in-progress") {
    const percent = bStats.total > 0 ? Math.round((bStats.counted / bStats.total) * 100) : 0;
    return (
      <button
        key={bin}
        className={`text-left px-3 py-2.5 rounded-lg border border-blue-200 hover:border-blue-300 hover:shadow-sm transition-all bg-blue-50`}
        onClick={() => selectBin(bin)}
      >
        <div className="flex items-center gap-1">
          <span className={`font-mono font-bold ${er ? "text-lg" : "text-sm"} truncate`}>{bin}</span>
          {hasSerialized && (
            <span className="text-[9px] font-semibold text-purple-700 bg-purple-100 px-1 py-0.5 rounded flex-shrink-0">S/N</span>
          )}
        </div>
        <div className={`${er ? "text-sm" : "text-[10px]"} text-muted-foreground mt-1`}>
          {bStats.lineItems} line{bStats.lineItems !== 1 ? "s" : ""} · {bStats.pending} left
        </div>
        <div className="flex items-center justify-end mt-1">
          <CircularProgress percent={percent} />
        </div>
        {bStats.supervisorEdited > 0 && (
          <span className={`${er ? "text-sm" : "text-[10px]"} font-medium text-indigo-700 mt-1 block`}>
            Supervisor edited
          </span>
        )}
      </button>
    );
  }

  if (variant === "completed") {
    const hasVariances = bStats.variances > 0;
    return (
      <button
        key={bin}
        className={`text-left px-3 py-2.5 rounded-lg border hover:shadow-sm transition-all ${
          hasVariances ? "bg-amber-50 border-amber-200 hover:border-amber-300" : "bg-green-50 border-green-200 hover:border-green-300"
        }`}
        onClick={() => selectBin(bin)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 min-w-0">
            <span className={`font-mono font-bold ${er ? "text-lg" : "text-sm"} truncate`}>{bin}</span>
            {hasSerialized && (
              <span className="text-[9px] font-semibold text-purple-700 bg-purple-100 px-1 py-0.5 rounded flex-shrink-0">S/N</span>
            )}
          </div>
          {hasVariances ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
          )}
        </div>
        <div className={`${er ? "text-sm" : "text-[10px]"} text-muted-foreground mt-1`}>
          {bStats.lineItems} line{bStats.lineItems !== 1 ? "s" : ""}
        </div>
        {hasVariances && (
          <span className={`${er ? "text-sm" : "text-[10px]"} font-medium text-amber-700 mt-0.5 block`}>
            {bStats.variances} variance{bStats.variances !== 1 ? "s" : ""}
          </span>
        )}
        {bStats.supervisorEdited > 0 && (
          <span className={`${er ? "text-sm" : "text-[10px]"} font-medium text-indigo-700 mt-0.5 block`}>
            Supervisor edited
          </span>
        )}
      </button>
    );
  }

  // not-started
  return (
    <button
      key={bin}
      className="text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/30 hover:shadow-sm transition-all bg-white"
      onClick={() => selectBin(bin)}
    >
      <div className="flex items-center gap-1">
        <span className={`font-mono font-bold ${er ? "text-lg" : "text-sm"} truncate`}>{bin}</span>
        {hasSerialized && (
          <span className="text-[9px] font-semibold text-purple-700 bg-purple-100 px-1 py-0.5 rounded flex-shrink-0">S/N</span>
        )}
      </div>
      <div className={`${er ? "text-sm" : "text-[10px]"} text-muted-foreground mt-1`}>
        {bStats.lineItems} line{bStats.lineItems !== 1 ? "s" : ""}
      </div>
    </button>
  );
}

function renderBinListItem(bin: string, bStats: BinStats, variant: BinVariant, er: boolean, selectBin: (bin: string) => void) {
  const hasSerialized = bStats.serialized > 0;
  const percent = bStats.total > 0 ? Math.round((bStats.counted / bStats.total) * 100) : 0;
  const hasVariances = bStats.variances > 0;

  const bgClass = variant === "in-progress"
    ? "bg-blue-50 border-blue-200"
    : variant === "completed"
      ? hasVariances ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
      : "bg-white border-border";

  return (
    <button
      key={bin}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border hover:shadow-sm transition-all text-left ${bgClass}`}
      onClick={() => variant === "completed" ? selectBin(bin) : selectBin(bin)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`font-mono font-bold ${er ? "text-lg" : "text-sm"}`}>{bin}</span>
          {hasSerialized && (
            <span className="text-[9px] font-semibold text-purple-700 bg-purple-100 px-1 py-0.5 rounded flex-shrink-0">S/N</span>
          )}
        </div>
        <span className={`${er ? "text-sm" : "text-[10px]"} text-muted-foreground`}>
          {bStats.lineItems} line{bStats.lineItems !== 1 ? "s" : ""}
          {variant === "in-progress" && ` · ${bStats.pending} left`}
          {variant === "completed" && hasVariances && ` · ${bStats.variances} variance${bStats.variances !== 1 ? "s" : ""}`}
        </span>
      </div>
      {variant === "in-progress" && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Progress value={percent} className="h-2 w-20" />
          <span className={`${er ? "text-sm" : "text-[10px]"} font-semibold text-blue-600 min-w-[2rem] text-right`}>{percent}%</span>
        </div>
      )}
      {variant === "completed" && (
        <div className="flex-shrink-0">
          {hasVariances ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
        </div>
      )}
    </button>
  );
}

/** Bins of one tab, grouped by aisle prefix with collapsible headers (grid or list layout). */
export function AisleGroupedBins({
  groups,
  variant,
  er,
  isListMode,
  collapsedAisles,
  toggleAisle,
  selectBin,
}: {
  groups: AisleGroup[];
  variant: BinVariant;
  er: boolean;
  isListMode: boolean;
  collapsedAisles: Set<string>;
  toggleAisle: (key: string) => void;
  selectBin: (bin: string) => void;
}) {
  const hasMultipleGroups = groups.length > 1;

  return groups.map((group) => {
    const isCollapsed = collapsedAisles.has(`${variant}-${group.prefix}`);
    const aisleKey = `${variant}-${group.prefix}`;
    const totalBins = group.bins.length;

    return (
      <div key={aisleKey}>
        {hasMultipleGroups && (
          <button
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2 mt-3 first:mt-0 hover:text-foreground transition-colors w-full text-left"
            onClick={() => toggleAisle(aisleKey)}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {group.prefix}
            <span className="text-xs text-muted-foreground/70">({totalBins})</span>
          </button>
        )}
        {!isCollapsed && (
          isListMode ? (
            <div className="space-y-2">
              {group.bins.map(([bin, bStats]) => renderBinListItem(bin, bStats, variant, er, selectBin))}
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {group.bins.map(([bin, bStats]) => renderBinButton(bin, bStats, variant, er, selectBin))}
            </div>
          )
        )}
      </div>
    );
  });
}
