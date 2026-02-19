"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, RotateCcw, ChevronRight, ChevronDown } from "lucide-react";
import { SuccessFlash } from "./success-flash";
import { useSettings } from "@/contexts/settings-context";

export interface CountItem {
  id: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  binNumber: string | null;
  binInternalId: string | null;
  onHand: number | null;
  avgCost: number | null;
  stockStatus: string | null;
  serialNumber: string | null;
  isSerialized: boolean | number | null;
  countId: number | null;
  countedQty: number | null;
  variance: number | null;
  isMatch: boolean | number | null;
  comment: string | null;
  checkStatus: string | null;
  countedAt: string | null;
  hasPendingVerification?: boolean;
}

interface ActiveItemCardProps {
  item: CountItem;
  qtyValue: string;
  onQtyChange: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  comment: string;
  onCommentChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  isSubmitting: boolean;
  showSuccessFlash?: boolean;
  onFlashComplete?: () => void;
  isVerification?: boolean;
}

// --- Queue abstraction for serialized grouping ---

export type QueueEntry =
  | { type: "single"; item: CountItem }
  | {
      type: "serialized-group";
      itemCode: string;
      description: string | null;
      brand: string | null;
      stockStatus: string | null;
      items: CountItem[];
    };

export function buildCountingQueue(pendingItems: CountItem[]): QueueEntry[] {
  const queue: QueueEntry[] = [];
  const serialGroupMap = new Map<string, CountItem[]>();
  const serialGroupFirstIndex = new Map<string, number>();

  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    const isSerialized = item.isSerialized === true || item.isSerialized === 1;

    if (isSerialized) {
      const key = item.itemCode;
      if (!serialGroupMap.has(key)) {
        serialGroupMap.set(key, []);
        serialGroupFirstIndex.set(key, i);
      }
      serialGroupMap.get(key)!.push(item);
    }
  }

  const usedSerialCodes = new Set<string>();

  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    const isSerialized = item.isSerialized === true || item.isSerialized === 1;

    if (isSerialized) {
      const key = item.itemCode;
      if (usedSerialCodes.has(key)) continue; // already added as group
      usedSerialCodes.add(key);

      const groupItems = serialGroupMap.get(key)!;
      queue.push({
        type: "serialized-group",
        itemCode: key,
        description: groupItems[0].description,
        brand: groupItems[0].brand,
        stockStatus: groupItems[0].stockStatus,
        items: groupItems,
      });
    } else {
      queue.push({ type: "single", item });
    }
  }

  return queue;
}

// --- Queue group row for Up Next display ---

interface QueueGroupRowProps {
  entry: QueueEntry & { type: "serialized-group" };
  position: number;
  onClick?: () => void;
}

export function QueueGroupRow({ entry, position, onClick }: QueueGroupRowProps) {
  return (
    <div
      className={`px-3 py-2 text-sm border-b last:border-b-0 bg-purple-50/30 ${onClick ? "cursor-pointer hover:bg-purple-100/50 active:bg-purple-100" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground w-6 text-right flex-shrink-0">
          {position}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-medium">
              {entry.itemCode}
            </span>
            <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">
              {entry.items.length} serials
            </Badge>
          </div>
          {entry.description && (
            <p className="text-muted-foreground text-xs mt-0.5 leading-snug">
              {entry.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function getStockStatusStyle(status: string | null): string {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("in stock") || s.includes("stocked"))
    return "bg-green-100 text-green-800 border-green-300";
  if (s.includes("out of stock") || s.includes("depleted"))
    return "bg-red-100 text-red-800 border-red-300";
  if (s.includes("discontinued") || s.includes("obsolete"))
    return "bg-gray-200 text-gray-700 border-gray-400";
  if (s.includes("on order") || s.includes("pending"))
    return "bg-blue-100 text-blue-800 border-blue-300";
  if (s.includes("non-stock") || s.includes("non stock"))
    return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-slate-100 text-slate-700 border-slate-300";
}

/** Compute live variance color state */
function getVarianceState(qtyValue: string, onHand: number): "empty" | "match" | "small" | "large" {
  if (!qtyValue) return "empty";
  const qty = Number(qtyValue);
  if (isNaN(qty)) return "empty";
  const v = qty - onHand;
  if (v === 0) return "match";
  if (Math.abs(v) <= 5) return "small";
  return "large";
}

const varianceInputStyles = {
  empty: "",
  match: "border-green-400 ring-2 ring-green-200",
  small: "border-amber-400 ring-2 ring-amber-200",
  large: "border-red-400 ring-2 ring-red-200",
};

const varianceBgStyles = {
  empty: "bg-muted/30",
  match: "bg-green-50",
  small: "bg-amber-50",
  large: "bg-red-50",
};

const varianceBarStyles = {
  empty: "bg-white",
  match: "bg-green-50",
  small: "bg-amber-50",
  large: "bg-red-50",
};

export function ActiveItemCard({
  item,
  qtyValue,
  onQtyChange,
  onSubmit,
  onSkip,
  comment,
  onCommentChange,
  inputRef,
  isSubmitting,
  showSuccessFlash,
  onFlashComplete,
  isVerification,
}: ActiveItemCardProps) {
  const { settings } = useSettings();
  const er = settings.easyRead;
  const isSerialized = item.isSerialized === true || item.isSerialized === 1;
  const [localShowComment, setLocalShowComment] = useState(false);

  const onHand = item.onHand ?? 0;
  const isMatchValue = qtyValue === String(onHand);
  const vState = getVarianceState(qtyValue, onHand);
  const liveVariance = qtyValue ? Number(qtyValue) - onHand : null;

  return (
    <>
      <Card className={`${er ? "border-[3px]" : "border-2"} relative ${isVerification ? "border-purple-400" : "border-primary/30"}`}>
        {showSuccessFlash && onFlashComplete && (
          <SuccessFlash onComplete={onFlashComplete} />
        )}
        <CardContent className={`p-4 ${er ? "space-y-5" : "space-y-4"} pb-48`}>
          {/* Verification badge */}
          {isVerification && (
            <Badge className={`bg-purple-100 text-purple-800 border-purple-300 ${er ? "text-sm" : "text-xs"}`}>
              Verification Count
            </Badge>
          )}

          {/* Bin number */}
          {item.binNumber && (
            <div className={`flex items-center gap-2 bg-slate-100 rounded-lg px-3 ${er ? "py-3" : "py-2"}`}>
              <span className={`${er ? "text-sm" : "text-xs"} font-medium text-muted-foreground uppercase tracking-wide`}>Bin</span>
              <span className={`font-mono font-bold ${er ? "text-lg" : "text-base"}`}>{item.binNumber}</span>
            </div>
          )}

          {/* Item Code */}
          <div className="space-y-1">
            <div className={`${er ? "text-xs" : "text-[10px]"} font-semibold text-muted-foreground uppercase tracking-wider`}>Item Code</div>
            <div className={`font-mono font-bold ${er ? "text-2xl" : "text-xl"} tracking-tight`}>
              {item.itemCode}
            </div>
          </div>

          {/* Description */}
          {item.description && (
            <div className="space-y-0.5">
              <div className={`${er ? "text-xs" : "text-[10px]"} font-semibold text-muted-foreground uppercase tracking-wider`}>Description</div>
              <div className={`${er ? "text-base" : "text-sm"} leading-snug`}>
                {item.description}
              </div>
            </div>
          )}

          {/* Metadata row */}
          <div className={`flex flex-wrap items-center ${er ? "gap-2" : "gap-1.5"}`}>
            {item.brand && (
              <Badge variant="secondary" className={er ? "text-sm" : "text-xs"}>
                {item.brand}
              </Badge>
            )}
            {item.stockStatus && (
              <Badge className={`${er ? "text-sm" : "text-xs"} ${getStockStatusStyle(item.stockStatus)}`}>
                {item.stockStatus}
              </Badge>
            )}
            {isSerialized && (
              <Badge className={`${er ? "text-sm" : "text-xs"} bg-purple-100 text-purple-800 border-purple-300`}>
                Serialized
              </Badge>
            )}
          </div>
          {isSerialized && item.serialNumber && (
            <div className={`${er ? "text-sm" : "text-xs"} font-mono text-purple-700 bg-purple-50 px-2 py-1 rounded`}>
              S/N: {item.serialNumber}
            </div>
          )}

          {/* On-hand quantity (with variance tint) */}
          <div className={`text-center py-2 rounded-lg ${varianceBgStyles[vState]}`}>
            <div className={`${er ? "text-sm" : "text-xs"} font-medium text-muted-foreground mb-1`}>On Hand</div>
            <div className={`${er ? "text-4xl" : "text-3xl"} font-bold`}>{onHand}</div>
          </div>

          {/* Skip + Add note */}
          <div className="flex items-center justify-between border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              className={er ? "text-sm" : "text-xs"}
              onClick={onSkip}
            >
              Skip
            </Button>
            <button
              type="button"
              onClick={() => setLocalShowComment((v) => !v)}
              className={`${er ? "text-sm" : "text-xs"} text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {localShowComment ? "Hide note" : "Add note"}
            </button>
          </div>

          {/* Comment textarea */}
          {localShowComment && (
            <Textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="Add a note about this item..."
              className={er ? "text-base" : "text-sm"}
              rows={2}
            />
          )}
        </CardContent>
      </Card>

      {/* Sticky Action Zone — fixed at bottom */}
      <div className={`fixed bottom-16 left-0 right-0 z-40 border-t shadow-lg ${varianceBarStyles[vState]} safe-area-bottom`}>
        <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
          {/* Input row: On-hand | Input | Live variance */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center flex-shrink-0 min-w-[3rem]">
              <span className="text-[10px] text-muted-foreground font-medium">OH</span>
              <span className={`${er ? "text-lg" : "text-base"} font-bold`}>{onHand}</span>
            </div>
            <Input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              value={qtyValue}
              onChange={(e) => onQtyChange(e.target.value)}
              placeholder="Qty"
              className={`${er ? "h-16 text-3xl" : "h-14 text-2xl"} text-center font-semibold flex-1 ${varianceInputStyles[vState]}`}
              disabled={isSubmitting}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
            <div className="flex flex-col items-center flex-shrink-0 min-w-[3rem]">
              <span className="text-[10px] text-muted-foreground font-medium">Var</span>
              {liveVariance !== null && !isNaN(liveVariance) ? (
                <span className={`${er ? "text-base" : "text-sm"} font-bold px-2 py-0.5 rounded-full ${
                  vState === "match" ? "text-green-700 bg-green-100" :
                  vState === "small" ? "text-amber-700 bg-amber-100" :
                  vState === "large" ? "text-red-700 bg-red-100" : ""
                }`}>
                  {liveVariance === 0 ? "MATCH" : `${liveVariance > 0 ? "+" : ""}${liveVariance}`}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>

          {/* Submit button */}
          {isMatchValue ? (
            <Button
              onClick={onSubmit}
              className={`w-full ${er ? "h-16 text-xl" : "h-14 text-lg"} font-bold text-white ${
                isVerification
                  ? "bg-purple-600 hover:bg-purple-700"
                  : "bg-green-600 hover:bg-green-700"
              }`}
              disabled={isSubmitting}
            >
              {isVerification ? "Submit Verification" : "MATCH"}
            </Button>
          ) : (
            <Button
              onClick={onSubmit}
              className={`w-full ${er ? "h-16 text-xl" : "h-14 text-lg"} font-bold text-white ${
                isVerification
                  ? "bg-purple-600 hover:bg-purple-700"
                  : "bg-amber-500 hover:bg-amber-600"
              }`}
              disabled={!qtyValue || isSubmitting}
            >
              {isVerification ? "Submit Verification" : "Submit Variance"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

interface QueueItemRowProps {
  item: CountItem;
  position: number;
  onClick?: () => void;
}

export function QueueItemRow({ item, position, onClick }: QueueItemRowProps) {
  return (
    <div
      className={`px-3 py-2 text-sm border-b last:border-b-0 ${onClick ? "cursor-pointer hover:bg-blue-50/50 active:bg-blue-100/50" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground w-6 text-right flex-shrink-0">
          {position}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-medium">
              {item.itemCode}
            </span>
            <span className="font-medium flex-shrink-0">
              {item.onHand ?? 0}
            </span>
          </div>
          {item.description && (
            <p className="text-muted-foreground text-xs mt-0.5 leading-snug">
              {item.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface CountedItemRowProps {
  item: CountItem;
  onRecount: (itemId: number) => void;
}

export function CountedItemRow({ item, onRecount }: CountedItemRowProps) {
  const variance = item.variance ?? 0;
  const isMatch = variance === 0;
  const isCounted = item.countId !== null;

  // Left border stripe color
  const borderColor = !isCounted
    ? "border-l-gray-300"
    : isMatch
      ? "border-l-green-500"
      : Math.abs(variance) <= 5
        ? "border-l-amber-500"
        : "border-l-red-500";

  return (
    <div className={`px-4 py-3 border-b last:border-b-0 border-l-4 ${borderColor} ${
      !isCounted ? "bg-amber-50/50" : isMatch ? "" : "bg-red-50/30"
    }`}>
      {/* Row 1: Item code + variance badge + recount */}
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono font-bold text-sm">
          {item.itemCode}
        </span>
        {item.stockStatus && (
          <Badge className={`text-[10px] px-1.5 py-0 ${getStockStatusStyle(item.stockStatus)}`}>
            {item.stockStatus}
          </Badge>
        )}
        <div className="flex-1" />
        {isCounted ? (
          <>
            <span
              className={`text-base font-bold px-2.5 py-0.5 rounded-full ${
                isMatch
                  ? "bg-green-100 text-green-800"
                  : Math.abs(variance) > 5
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-800"
              }`}
            >
              {isMatch ? "Match" : `${variance > 0 ? "+" : ""}${variance}`}
            </span>
            {item.checkStatus === "accepted" && (
              <Badge className="text-xs bg-indigo-100 text-indigo-800 border-indigo-300">
                Locked
              </Badge>
            )}
            {item.hasPendingVerification && (
              <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">
                Verification Pending
              </Badge>
            )}
          </>
        ) : (
          <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
            Pending
          </Badge>
        )}
        {item.checkStatus !== "accepted" && !item.hasPendingVerification && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onRecount(item.id)}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Recount
          </Button>
        )}
      </div>

      {/* Row 2: Description */}
      {item.description && (
        <div className="text-sm text-muted-foreground leading-snug mb-2">
          {item.description}
        </div>
      )}

      {/* Row 3: Quantities */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">On Hand:</span>
          <span className="font-semibold">{item.onHand ?? 0}</span>
        </div>
        <span className="text-muted-foreground">→</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Counted:</span>
          <span className="font-semibold">{item.countedQty ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

// --- Serialized group display for review state ---

export interface ReviewDisplayRow {
  type: "single" | "serialized-group";
  item?: CountItem;
  itemCode?: string;
  description?: string | null;
  items?: CountItem[];
  totalOnHand?: number;
  totalCounted?: number;
  totalVariance?: number;
  foundCount?: number;
  notFoundCount?: number;
  pendingCount?: number;
}

export function groupReviewItems(items: CountItem[]): ReviewDisplayRow[] {
  const groupMap = new Map<string, { firstIndex: number; items: CountItem[] }>();
  const result: ReviewDisplayRow[] = [];
  const usedKeys = new Set<string>();

  // First pass: collect serialized items by itemCode
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isSerialized = item.isSerialized === true || item.isSerialized === 1;
    if (!isSerialized) continue;

    const key = item.itemCode;
    if (!groupMap.has(key)) {
      groupMap.set(key, { firstIndex: i, items: [] });
    }
    groupMap.get(key)!.items.push(item);
  }

  // Second pass: build result
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isSerialized = item.isSerialized === true || item.isSerialized === 1;

    if (!isSerialized) {
      result.push({ type: "single", item });
      continue;
    }

    const key = item.itemCode;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);

    const group = groupMap.get(key)!;
    if (group.items.length === 1) {
      result.push({ type: "single", item: group.items[0] });
      continue;
    }

    let totalOnHand = 0;
    let totalCounted = 0;
    let totalVariance = 0;
    let foundCount = 0;
    let notFoundCount = 0;
    let pendingCount = 0;

    for (const gi of group.items) {
      totalOnHand += gi.onHand ?? 0;
      if (gi.countId !== null) {
        totalCounted += gi.countedQty ?? 0;
        totalVariance += gi.variance ?? 0;
        if ((gi.countedQty ?? 0) > 0) foundCount++;
        else notFoundCount++;
      } else {
        pendingCount++;
      }
    }

    result.push({
      type: "serialized-group",
      itemCode: group.items[0].itemCode,
      description: group.items[0].description,
      items: group.items,
      totalOnHand,
      totalCounted,
      totalVariance,
      foundCount,
      notFoundCount,
      pendingCount,
    });
  }

  return result;
}

interface CountedSerialGroupRowProps {
  row: ReviewDisplayRow & { type: "serialized-group" };
  onRecount: (itemId: number) => void;
}

export function CountedSerialGroupRow({ row, onRecount }: CountedSerialGroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const totalItems = row.items!.length;
  const totalVariance = row.totalVariance ?? 0;
  const hasVariance = totalVariance !== 0;
  const allCounted = (row.pendingCount ?? 0) === 0;

  return (
    <div className="border-b last:border-b-0">
      {/* Collapsed header */}
      <div
        className={`px-4 py-3 cursor-pointer hover:bg-purple-50/50 ${hasVariance ? "bg-red-50/20" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 mb-1">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-purple-600 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-purple-600 flex-shrink-0" />
          )}
          <span className="font-mono font-bold text-sm">{row.itemCode}</span>
          <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-[10px]">
            {totalItems} serials
          </Badge>
          <div className="flex-1" />
          {allCounted ? (
            <Badge
              className={`text-xs ${
                hasVariance
                  ? Math.abs(totalVariance) > 5
                    ? "bg-red-100 text-red-800 border-red-300"
                    : "bg-amber-100 text-amber-800 border-amber-300"
                  : "bg-green-100 text-green-800 border-green-300"
              }`}
            >
              {hasVariance ? `${totalVariance > 0 ? "+" : ""}${totalVariance}` : "All Match"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
              {row.pendingCount} pending
            </Badge>
          )}
        </div>
        {row.description && (
          <div className="text-sm text-muted-foreground leading-snug mb-1 ml-6">
            {row.description}
          </div>
        )}
        <div className="flex items-center gap-4 text-sm ml-6">
          {(row.foundCount ?? 0) > 0 && (
            <span className="text-green-600 text-xs">{row.foundCount} found</span>
          )}
          {(row.notFoundCount ?? 0) > 0 && (
            <span className="text-red-600 text-xs">{row.notFoundCount} not found</span>
          )}
          {(row.pendingCount ?? 0) > 0 && (
            <span className="text-muted-foreground text-xs">{row.pendingCount} pending</span>
          )}
        </div>
      </div>

      {/* Expanded sub-rows */}
      {expanded && row.items!.map((item) => {
        const variance = item.variance ?? 0;
        const isCounted = item.countId !== null;
        const isMatch = variance === 0 && isCounted;

        return (
          <div
            key={item.id}
            className={`px-4 py-2 border-t border-dashed ml-6 ${
              !isCounted ? "bg-amber-50/30" : isMatch ? "bg-purple-50/10" : "bg-red-50/20"
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-[10px] font-mono">
                S/N: {item.serialNumber || "—"}
              </Badge>
              <div className="flex-1" />
              {isCounted ? (
                <Badge
                  className={`text-xs ${
                    isMatch
                      ? "bg-green-100 text-green-800 border-green-300"
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  {isMatch ? "Found" : "Not Found"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                  Pending
                </Badge>
              )}
              {item.checkStatus === "accepted" && (
                <Badge className="text-[10px] bg-indigo-100 text-indigo-800 border-indigo-300">
                  Locked
                </Badge>
              )}
              {item.hasPendingVerification && (
                <Badge className="text-[10px] bg-purple-100 text-purple-800 border-purple-300">
                  Verification Pending
                </Badge>
              )}
              {item.checkStatus !== "accepted" && !item.hasPendingVerification && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRecount(item.id);
                  }}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Recount
                </Button>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-muted-foreground">On Hand: <span className="font-semibold text-foreground">{item.onHand ?? 0}</span></span>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">Counted: <span className="font-semibold text-foreground">{item.countedQty ?? "—"}</span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
