"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, ScanBarcode, X, Check } from "lucide-react";
import { SuccessFlash } from "./success-flash";
import { getStockStatusStyle, type QueueEntry } from "./item-card";

type SerializedGroup = QueueEntry & { type: "serialized-group" };

export interface SerialGroupResult {
  itemId: number;
  qty: number;
}

interface SerializedGroupCardProps {
  entry: SerializedGroup;
  onSubmitAll: (results: SerialGroupResult[], unknownSerials?: string[]) => void;
  onSkip: () => void;
  isSubmitting: boolean;
  showSuccessFlash?: boolean;
  onFlashComplete?: () => void;
  comment: string;
  onCommentChange: (value: string) => void;
}

export function SerializedGroupCard({
  entry,
  onSubmitAll,
  onSkip,
  isSubmitting,
  showSuccessFlash,
  onFlashComplete,
  comment,
  onCommentChange,
}: SerializedGroupCardProps) {
  // Default all toggles to "not-found" — user marks items as Found when physically located
  const [toggles, setToggles] = useState<Record<number, "found" | "not-found">>(() => {
    const initial: Record<number, "found" | "not-found"> = {};
    for (const item of entry.items) {
      initial[item.id] = "not-found";
    }
    return initial;
  });

  const [showComment, setShowComment] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [unknownSerials, setUnknownSerials] = useState<string[]>([]);
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [scanMessage, setScanMessage] = useState<{ text: string; type: "success" | "duplicate" } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);


  const foundCount = entry.items.filter((item) => toggles[item.id] === "found").length;
  const notFoundCount = entry.items.length - foundCount;
  const allFound = notFoundCount === 0;
  const allNotFound = foundCount === 0;

  // Auto-focus scanner input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      scanInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Clear highlight + scan message after animation
  useEffect(() => {
    if (highlightedItemId === null && scanMessage === null) return;
    const timer = setTimeout(() => {
      setHighlightedItemId(null);
      setScanMessage(null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [highlightedItemId, scanMessage]);

  function toggleItem(itemId: number) {
    setToggles((prev) => ({
      ...prev,
      [itemId]: prev[itemId] === "found" ? "not-found" : "found",
    }));
  }

  const handleScan = useCallback(() => {
    const scanned = scanInput.trim();
    if (!scanned) return;

    // Case-insensitive match against group's serial numbers
    const matchedItem = entry.items.find(
      (item) => item.serialNumber?.toLowerCase() === scanned.toLowerCase()
    );

    if (matchedItem) {
      // Check if already marked found
      const alreadyFound = toggles[matchedItem.id] === "found";
      if (alreadyFound) {
        setScanMessage({ text: `${matchedItem.serialNumber} — already scanned`, type: "duplicate" });
      } else {
        setToggles((prev) => ({ ...prev, [matchedItem.id]: "found" }));
        setHighlightedItemId(matchedItem.id);
        setScanMessage({ text: `${matchedItem.serialNumber} — matched!`, type: "success" });
      }
    } else {
      // Add to unknown serials (dedup)
      setUnknownSerials((prev) => {
        if (prev.some((s) => s.toLowerCase() === scanned.toLowerCase())) return prev;
        return [...prev, scanned];
      });
    }

    // Clear input and re-focus
    setScanInput("");
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }, [scanInput, entry.items, toggles]);

  function removeUnknownSerial(index: number) {
    setUnknownSerials((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit() {
    const results: SerialGroupResult[] = entry.items.map((item) => ({
      itemId: item.id,
      qty: toggles[item.id] === "found" ? 1 : 0,
    }));
    onSubmitAll(results, unknownSerials.length > 0 ? unknownSerials : undefined);
  }

  return (
    <Card className="border-2 relative border-purple-400">
      {showSuccessFlash && onFlashComplete && (
        <SuccessFlash onComplete={onFlashComplete} />
      )}
      <CardContent className="p-4 space-y-4">
        {/* Header: item code */}
        <div className="space-y-1">
          <div className="font-mono font-bold text-xl tracking-tight">
            {entry.itemCode}
          </div>
          {entry.description && (
            <div className="text-sm text-muted-foreground leading-snug">
              {entry.description}
            </div>
          )}
        </div>

        {/* Metadata badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.brand && (
            <Badge variant="secondary" className="text-xs">
              {entry.brand}
            </Badge>
          )}
          {entry.stockStatus && (
            <Badge className={`text-xs ${getStockStatusStyle(entry.stockStatus)}`}>
              {entry.stockStatus}
            </Badge>
          )}
          <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">
            Serialized
          </Badge>
          <Badge variant="outline" className="text-xs">
            {entry.items.length} serial{entry.items.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        {/* Scanner input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={scanInputRef}
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan();
                }
              }}
              placeholder="Scan or type serial number..."
              className="pl-9 h-10"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 flex-shrink-0"
            onClick={handleScan}
            disabled={!scanInput.trim()}
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
        {scanMessage && (
          <div className={`text-xs font-medium px-3 py-1.5 rounded-md ${
            scanMessage.type === "success"
              ? "text-green-800 bg-green-100 border border-green-200"
              : "text-amber-800 bg-amber-100 border border-amber-200"
          }`}>
            {scanMessage.type === "success" ? "\u2713" : "\u2022"} {scanMessage.text}
          </div>
        )}

        {/* Unknown serials list */}
        {unknownSerials.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
            <div className="text-xs font-medium text-amber-800">
              Unknown serials ({unknownSerials.length}) — will be sent to supervisor
            </div>
            <div className="space-y-1">
              {unknownSerials.map((serial, idx) => (
                <div
                  key={`${serial}-${idx}`}
                  className="flex items-center gap-2 text-sm font-mono text-amber-900 bg-amber-100/50 px-2 py-1 rounded"
                >
                  <span className="flex-1 truncate">{serial}</span>
                  <button
                    type="button"
                    onClick={() => removeUnknownSerial(idx)}
                    className="text-amber-600 hover:text-amber-800 flex-shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Serial number list with Found/Not Found toggles */}
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Mark each serial as Found or Not Found:
          </div>
          <div className="space-y-1.5">
            {entry.items.map((item) => (
              <SerialRow
                key={item.id}
                item={item}
                status={toggles[item.id]}
                onToggle={() => toggleItem(item.id)}
                isHighlighted={highlightedItemId === item.id}
              />
            ))}
          </div>
        </div>

        {/* Summary + Submit button */}
        <div className="text-center text-sm text-muted-foreground">
          {foundCount} found · {notFoundCount} not found
        </div>
        {allFound ? (
          <Button
            onClick={handleSubmit}
            className="w-full h-14 text-lg font-bold text-white bg-green-600 hover:bg-green-700"
            disabled={isSubmitting}
          >
            All Match
          </Button>
        ) : allNotFound ? (
          <Button
            onClick={handleSubmit}
            className="w-full h-14 text-lg font-bold text-white bg-red-600 hover:bg-red-700"
            disabled={isSubmitting}
          >
            Submit All Not Found
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            className="w-full h-14 text-lg font-bold text-white bg-amber-500 hover:bg-amber-600"
            disabled={isSubmitting}
          >
            Submit — {foundCount} Found, {notFoundCount} Not Found
          </Button>
        )}

        {/* Keyboard hints */}
        <div className="text-xs text-muted-foreground text-center">
          Esc = go back
        </div>

        {/* Skip + Add note */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={onSkip}
          >
            Skip this group
          </Button>

          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <MessageSquare className="h-3 w-3" />
            {showComment ? "Hide note" : "Add note"}
          </button>
        </div>

        {/* Comment textarea */}
        {showComment && (
          <Textarea
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="Add a note about this group..."
            className="text-sm"
            rows={2}
          />
        )}
      </CardContent>
    </Card>
  );
}

// Individual serial row with toggle
function SerialRow({
  item,
  status,
  onToggle,
  isHighlighted,
}: {
  item: { id: number; serialNumber: string | null; onHand: number | null };
  status: "found" | "not-found";
  onToggle: () => void;
  isHighlighted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
        isHighlighted
          ? "border-green-400 bg-green-100 animate-pulse"
          : status === "found"
            ? "border-green-200 bg-green-50/50"
            : "border-red-200 bg-red-50/50"
      }`}
    >
      <span className="font-mono text-sm flex-1 min-w-0 truncate text-purple-700">
        S/N: {item.serialNumber || "—"}
      </span>

      <button
        type="button"
        onClick={onToggle}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
          status === "found"
            ? "bg-green-600 text-white"
            : "bg-muted text-muted-foreground hover:bg-green-100"
        }`}
      >
        Found
      </button>
      <button
        type="button"
        onClick={onToggle}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
          status === "not-found"
            ? "bg-red-600 text-white"
            : "bg-muted text-muted-foreground hover:bg-red-100"
        }`}
      >
        Not Found
      </button>
    </div>
  );
}
