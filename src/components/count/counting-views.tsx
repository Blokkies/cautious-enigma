"use client";

import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ActiveItemCard,
  QueueItemRow,
  QueueGroupRow,
  CountedItemRow,
  CountedSerialGroupRow,
  type CountItem,
  type QueueEntry,
  type ReviewDisplayRow,
} from "@/components/counting/item-card";
import { SerializedGroupCard, type SerialGroupResult } from "@/components/counting/serialized-group-card";
import { ArrowLeft, CheckCircle2, Search, AlertTriangle } from "lucide-react";
import { isMatchTrue } from "./types";

type ScopedStats = { total: number; counted: number; pending: number; percent: number };

function binLabelFor(selectedBin: string | null) {
  return selectedBin === "all" ? "All Bins" : selectedBin || "Items";
}

/** Main counting screen: active item / serialized group plus the searchable "Up Next" queue. */
export function CountingView({
  selectedBin,
  scopedStats,
  currentEntry,
  countingQueue,
  upcomingEntries,
  onBack,
  qtyValue,
  setQtyValue,
  comment,
  setComment,
  onSubmitCount,
  onSubmitSerializedGroup,
  onSkip,
  inputRef,
  isSubmitting,
  showFlash,
  onFlashComplete,
  queueSearch,
  setQueueSearch,
  jumpToEntry,
}: {
  selectedBin: string | null;
  scopedStats: ScopedStats;
  currentEntry: QueueEntry;
  countingQueue: QueueEntry[];
  upcomingEntries: QueueEntry[];
  onBack: () => void;
  qtyValue: string;
  setQtyValue: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  onSubmitCount: () => void;
  onSubmitSerializedGroup: (results: SerialGroupResult[], unknownSerials?: string[]) => void | Promise<void>;
  onSkip: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isSubmitting: boolean;
  showFlash: boolean;
  onFlashComplete: () => void;
  queueSearch: string;
  setQueueSearch: (v: string) => void;
  jumpToEntry: (queueIndex: number) => void;
}) {
  const binLabel = binLabelFor(selectedBin);

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Sticky header */}
      <div className="sticky top-14 z-40 bg-white border-b px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 bg-slate-100 rounded-md px-2.5 py-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Bin</span>
            <span className="font-mono font-bold text-base">{binLabel}</span>
          </div>
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">
            {scopedStats.pending} left
          </span>
          <span className="text-sm font-semibold">
            {scopedStats.percent}%
          </span>
        </div>
        <Progress value={scopedStats.percent} className="h-2" />
      </div>

      {/* Main content — extra pb for sticky action bar */}
      <div className="flex-1 overflow-y-auto p-4 pb-52 space-y-4">
        {/* Active item or serialized group */}
        <div className="max-w-lg mx-auto">
          {currentEntry.type === "serialized-group" ? (
            <SerializedGroupCard
              key={currentEntry.items[0]?.id}
              entry={currentEntry}
              onSubmitAll={onSubmitSerializedGroup}
              onSkip={onSkip}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={onFlashComplete}
              comment={comment}
              onCommentChange={setComment}
            />
          ) : (
            <ActiveItemCard
              item={currentEntry.item}
              qtyValue={qtyValue}
              onQtyChange={setQtyValue}
              onSubmit={onSubmitCount}
              onSkip={onSkip}
              comment={comment}
              onCommentChange={setComment}
              inputRef={inputRef}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={onFlashComplete}
            />
          )}
        </div>

        {/* Queue */}
        {upcomingEntries.length > 0 && (
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-muted-foreground">
                Up Next ({upcomingEntries.length} more)
              </div>
            </div>
            {upcomingEntries.length > 3 && (
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={queueSearch}
                  onChange={(e) => setQueueSearch(e.target.value)}
                  placeholder="Search queue by code or description..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
            )}
            <Card>
              <div className="max-h-[400px] overflow-y-auto">
                <CardContent className="p-0">
                  {(() => {
                    const q = queueSearch.toLowerCase().trim();
                    const filtered = q
                      ? upcomingEntries.filter((entry) => {
                          if (entry.type === "serialized-group") {
                            return (
                              entry.itemCode.toLowerCase().includes(q) ||
                              (entry.description?.toLowerCase().includes(q) ?? false)
                            );
                          }
                          return (
                            entry.item.itemCode.toLowerCase().includes(q) ||
                            (entry.item.description?.toLowerCase().includes(q) ?? false)
                          );
                        })
                      : upcomingEntries;

                    if (filtered.length === 0) {
                      return (
                        <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                          No items match &ldquo;{queueSearch}&rdquo;
                        </div>
                      );
                    }

                    return filtered.map((entry) => {
                      // Find the actual queue index for this entry to enable jumping
                      const queueIdx = countingQueue.indexOf(entry);
                      return entry.type === "serialized-group" ? (
                        <QueueGroupRow
                          key={`group-${entry.itemCode}`}
                          entry={entry}
                          position={queueIdx + 1}
                          onClick={() => jumpToEntry(queueIdx)}
                        />
                      ) : (
                        <QueueItemRow
                          key={entry.item.id}
                          item={entry.item}
                          position={queueIdx + 1}
                          onClick={() => jumpToEntry(queueIdx)}
                        />
                      );
                    });
                  })()}
                </CardContent>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/** Recount of an already-counted item (uses the same ActiveItemCard as initial count). */
export function RecountView({
  selectedBin,
  recountItem,
  qtyValue,
  setQtyValue,
  comment,
  setComment,
  onSubmit,
  onCancel,
  inputRef,
  isSubmitting,
}: {
  selectedBin: string | null;
  recountItem: CountItem;
  qtyValue: string;
  setQtyValue: (v: string) => void;
  comment: string;
  setComment: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isSubmitting: boolean;
}) {
  const binLabel = binLabelFor(selectedBin);

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Sticky header */}
      <div className="sticky top-14 z-40 bg-white border-b px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 bg-slate-100 rounded-md px-2.5 py-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Bin</span>
            <span className="font-mono font-bold text-base">{binLabel}</span>
          </div>
          <div className="flex-1" />
          <Badge variant="outline" className="text-xs">Recount</Badge>
        </div>
      </div>

      {/* Main content — same ActiveItemCard as initial counting */}
      <div className="flex-1 overflow-y-auto p-4 pb-52 space-y-4">
        <div className="max-w-lg mx-auto">
          <ActiveItemCard
            item={recountItem}
            qtyValue={qtyValue}
            onQtyChange={setQtyValue}
            onSubmit={onSubmit}
            onSkip={onCancel}
            comment={comment}
            onCommentChange={setComment}
            inputRef={inputRef}
            isSubmitting={isSubmitting}
            showSuccessFlash={false}
            onFlashComplete={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

/** Review of every item in the selected bin, with recount buttons. */
export function ReviewView({
  selectedBin,
  scopedStats,
  reviewItems,
  groupedReviewItems,
  onBack,
  onContinueCounting,
  onRecount,
}: {
  selectedBin: string | null;
  scopedStats: ScopedStats;
  reviewItems: CountItem[];
  groupedReviewItems: ReviewDisplayRow[];
  onBack: () => void;
  onContinueCounting: () => void;
  onRecount: (itemId: number) => void;
}) {
  const binLabel = binLabelFor(selectedBin);
  const pendingInBin = reviewItems.filter((i) => i.countId === null);
  const countedInBin = reviewItems.filter((i) => i.countId !== null);
  const matchCount = countedInBin.filter(
    (i) => i.variance === 0 || isMatchTrue(i.isMatch)
  ).length;
  const varianceCount = countedInBin.length - matchCount;

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Header */}
      <div className="sticky top-14 z-40 bg-white border-b px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-mono font-bold text-base">{binLabel}</span>
          <div className="flex-1" />
          <span className="text-sm font-semibold">
            {scopedStats.percent}%
          </span>
        </div>
        {/* Summary stats */}
        <div className="flex items-center gap-3 text-sm pl-9">
          <span className="text-muted-foreground">
            {reviewItems.length} items
          </span>
          {matchCount > 0 && (
            <span className="text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {matchCount} matched
            </span>
          )}
          {varianceCount > 0 && (
            <span className="text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {varianceCount} variance{varianceCount !== 1 ? "s" : ""}
            </span>
          )}
          {pendingInBin.length > 0 && (
            <span className="text-muted-foreground">
              {pendingInBin.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {pendingInBin.length > 0 && (
            <Button
              className="w-full"
              onClick={onContinueCounting}
            >
              Continue Counting ({pendingInBin.length} remaining)
            </Button>
          )}

          <Card>
            <CardContent className="p-0">
              {groupedReviewItems.map((row, rowIdx) => {
                if (row.type === "serialized-group") {
                  return (
                    <CountedSerialGroupRow
                      key={`group-${row.itemCode}-${rowIdx}`}
                      row={row as ReviewDisplayRow & { type: "serialized-group" }}
                      onRecount={onRecount}
                    />
                  );
                }

                const item = row.item!;
                return (
                  <CountedItemRow
                    key={item.id}
                    item={item}
                    onRecount={onRecount}
                  />
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** "All Done!" screen (pageState === "complete"). */
export function CountCompleteView({
  selectedBin,
  onBack,
  onReview,
}: {
  selectedBin: string | null;
  onBack: () => void;
  onReview: () => void;
}) {
  const binLabel =
    selectedBin === "all"
      ? "all bins"
      : selectedBin || "this selection";

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-7.5rem)] gap-4 p-4">
      <CheckCircle2 className="h-16 w-16 text-green-500" />
      <h2 className="text-2xl font-bold">All Done!</h2>
      <p className="text-muted-foreground text-center">
        All items in {binLabel} have been counted
      </p>
      <div className="flex gap-3 mt-4">
        <Button variant="outline" onClick={onBack}>
          Choose Another Bin
        </Button>
        <Button
          variant="outline"
          onClick={onReview}
        >
          Review Items
        </Button>
        <Button onClick={onBack}>
          Back to Bins
        </Button>
      </div>
    </div>
  );
}
