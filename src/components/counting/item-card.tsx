"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, RotateCcw } from "lucide-react";

export interface CountItem {
  id: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  binNumber: string | null;
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
  countedAt: string | null;
}

interface ActiveItemCardProps {
  item: CountItem;
  qtyValue: string;
  onQtyChange: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  comment: string;
  onCommentChange: (value: string) => void;
  showComment: boolean;
  onToggleComment: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  isSubmitting: boolean;
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

export function ActiveItemCard({
  item,
  qtyValue,
  onQtyChange,
  onSubmit,
  onSkip,
  comment,
  onCommentChange,
  showComment,
  onToggleComment,
  inputRef,
  isSubmitting,
}: ActiveItemCardProps) {
  const isSerialized = item.isSerialized === true || item.isSerialized === 1;

  return (
    <Card className="border-2 border-primary/30">
      <CardContent className="p-4 space-y-4">
        {/* Item Code — prominent */}
        <div className="space-y-1">
          <div className="font-mono font-bold text-xl tracking-tight">
            {item.itemCode}
          </div>

          {/* Description — always fully visible */}
          {item.description && (
            <div className="text-sm text-muted-foreground leading-snug">
              {item.description}
            </div>
          )}
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {item.binNumber && (
            <Badge variant="outline" className="text-xs font-mono bg-blue-50 text-blue-700 border-blue-200">
              {item.binNumber}
            </Badge>
          )}
          {item.brand && (
            <Badge variant="secondary" className="text-xs">
              {item.brand}
            </Badge>
          )}
          {item.stockStatus && (
            <Badge className={`text-xs ${getStockStatusStyle(item.stockStatus)}`}>
              {item.stockStatus}
            </Badge>
          )}
          {isSerialized && (
            <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">
              Serialized
            </Badge>
          )}
        </div>
        {isSerialized && item.serialNumber && (
          <div className="text-xs font-mono text-purple-700 bg-purple-50 px-2 py-1 rounded">
            S/N: {item.serialNumber}
          </div>
        )}

        {/* On-hand quantity */}
        <div className="text-center py-2 bg-muted/30 rounded-lg">
          <div className="text-xs font-medium text-muted-foreground mb-1">On Hand</div>
          <div className="text-4xl font-bold">{item.onHand ?? 0}</div>
        </div>

        {/* Quantity input + Submit */}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            value={qtyValue}
            onChange={(e) => onQtyChange(e.target.value)}
            placeholder="Enter quantity"
            className="h-14 text-xl text-center flex-1"
            disabled={isSubmitting}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              } else if (e.key === "Tab") {
                e.preventDefault();
                onSkip();
              }
            }}
          />
          <Button
            onClick={onSubmit}
            className="h-14 px-6 text-base"
            disabled={!qtyValue || isSubmitting}
          >
            Submit
          </Button>
        </div>

        {/* Keyboard hints */}
        <div className="text-xs text-muted-foreground text-center">
          Enter to submit · Tab to skip · Esc to go back
        </div>

        {/* Comment section — always visible area */}
        <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
          <button
            type="button"
            onClick={onToggleComment}
            className="flex items-center gap-2 text-sm font-medium text-foreground w-full text-left"
          >
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            {showComment ? "Comment" : "Add Comment"}
          </button>
          {showComment && (
            <Textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="Add a comment about this item..."
              className="text-sm bg-white"
              rows={2}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface QueueItemRowProps {
  item: CountItem;
  position: number;
}

export function QueueItemRow({ item, position }: QueueItemRowProps) {
  return (
    <div className="px-3 py-2 text-sm border-b last:border-b-0">
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

  return (
    <div className={`px-4 py-3 border-b last:border-b-0 ${
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
          <Badge
            className={`text-xs ${
              isMatch
                ? "bg-green-100 text-green-800 border-green-300"
                : Math.abs(variance) > 5
                  ? "bg-red-100 text-red-800 border-red-300"
                  : "bg-amber-100 text-amber-800 border-amber-300"
            }`}
          >
            {isMatch ? "Match" : `${variance > 0 ? "+" : ""}${variance}`}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
            Pending
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onRecount(item.id)}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Recount
        </Button>
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
