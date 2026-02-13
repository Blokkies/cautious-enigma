"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, ScanBarcode, X, Check, RotateCcw, ChevronDown, ChevronUp, Search } from "lucide-react";
import { SuccessFlash } from "./success-flash";
import { getStockStatusStyle, type QueueEntry } from "./item-card";

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SavedProgress {
  toggles: Record<number, "found" | "not-found">;
  unknownSerials: string[];
  savedAt: number;
}

function loadSavedProgress(
  storageKey: string,
  currentItemIds: Set<number>
): SavedProgress | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedProgress;
    // Check expiry
    if (Date.now() - data.savedAt > EXPIRY_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    // Validate that stored IDs match current items
    const storedIdKeys = Object.keys(data.toggles);
    if (storedIdKeys.length !== currentItemIds.size) return null;
    const mismatch = storedIdKeys.some((k) => !currentItemIds.has(Number(k)));
    if (mismatch) return null;
    return data;
  } catch {
    return null;
  }
}

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
  const storageKey = `serial-progress-${entry.items[0]?.id}`;
  const currentItemIds = React.useMemo(
    () => new Set(entry.items.map((i) => i.id)),
    [entry.items]
  );

  // Load saved progress on mount (lazy initializer — runs once)
  const saved = React.useMemo(
    () => loadSavedProgress(storageKey, currentItemIds),
    [storageKey, currentItemIds]
  );

  const [restoredProgress, setRestoredProgress] = useState(!!saved);

  const [toggles, setToggles] = useState<Record<number, "found" | "not-found">>(() => {
    if (saved) return saved.toggles;
    const initial: Record<number, "found" | "not-found"> = {};
    for (const item of entry.items) {
      initial[item.id] = "not-found";
    }
    return initial;
  });

  const [showComment, setShowComment] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [unknownSerials, setUnknownSerials] = useState<string[]>(
    () => saved?.unknownSerials ?? []
  );
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [scanMessage, setScanMessage] = useState<{ text: string; type: "success" | "duplicate" | "cross-bin" | "unknown" } | null>(null);
  const [showList, setShowList] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);


  const foundCount = entry.items.filter((item) => toggles[item.id] === "found").length;
  const notFoundCount = entry.items.length - foundCount;
  const allFound = notFoundCount === 0;
  const allNotFound = foundCount === 0;

  const filteredItems = React.useMemo(() => {
    if (!filterText.trim()) return entry.items;
    const q = filterText.trim().toLowerCase();
    return entry.items.filter(
      (item) => item.serialNumber?.toLowerCase().includes(q)
    );
  }, [entry.items, filterText]);

  // Auto-focus scanner input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      scanInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Auto-dismiss "progress restored" indicator after 3s
  useEffect(() => {
    if (!restoredProgress) return;
    const timer = setTimeout(() => setRestoredProgress(false), 3000);
    return () => clearTimeout(timer);
  }, [restoredProgress]);

  // Auto-save toggles + unknown serials to localStorage on change
  useEffect(() => {
    const hasProgress =
      Object.values(toggles).some((v) => v === "found") ||
      unknownSerials.length > 0;
    if (hasProgress) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ toggles, unknownSerials, savedAt: Date.now() })
      );
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [toggles, unknownSerials, storageKey]);

  // Clear highlight + scan message after animation (4s for cross-bin/unknown, 1.5s otherwise)
  useEffect(() => {
    if (highlightedItemId === null && scanMessage === null) return;
    const duration = scanMessage?.type === "cross-bin" || scanMessage?.type === "unknown" ? 4000 : 1500;
    const timer = setTimeout(() => {
      setHighlightedItemId(null);
      setScanMessage(null);
    }, duration);
    return () => clearTimeout(timer);
  }, [highlightedItemId, scanMessage]);

  function toggleItem(itemId: number) {
    setToggles((prev) => ({
      ...prev,
      [itemId]: prev[itemId] === "found" ? "not-found" : "found",
    }));
  }

  const handleScan = useCallback(async () => {
    const scanned = scanInput.trim();
    if (!scanned) return;

    // Clear input immediately so scanner can continue
    setScanInput("");

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
      // Not in this group — check if it belongs to another bin
      try {
        const res = await fetch(`/api/team/serial-lookup?serial=${encodeURIComponent(scanned)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.found) {
            setScanMessage({
              text: `${scanned} — Expected in Bin ${data.binNumber}`,
              type: "cross-bin",
            });
          } else {
            setScanMessage({
              text: `${scanned} — Unknown serial`,
              type: "unknown",
            });
          }
        }
      } catch {
        // Offline — just show as unknown
        setScanMessage({
          text: `${scanned} — Unknown serial`,
          type: "unknown",
        });
      }

      // Add to unknown serials (dedup) either way
      setUnknownSerials((prev) => {
        if (prev.some((s) => s.toLowerCase() === scanned.toLowerCase())) return prev;
        return [...prev, scanned];
      });
    }

    // Re-focus
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }, [scanInput, entry.items, toggles]);

  function removeUnknownSerial(index: number) {
    setUnknownSerials((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmitClick() {
    if (notFoundCount > 0 && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    doSubmit();
  }

  function doSubmit() {
    setShowConfirm(false);
    localStorage.removeItem(storageKey);
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
        {/* Bin number — prominent on card */}
        {entry.items[0]?.binNumber && (
          <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bin</span>
            <span className="font-mono font-bold text-base">{entry.items[0].binNumber}</span>
          </div>
        )}

        {/* Item Code — labeled */}
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Item Code</div>
          <div className="font-mono font-bold text-xl tracking-tight">
            {entry.itemCode}
          </div>
        </div>

        {/* Description — labeled */}
        {entry.description && (
          <div className="space-y-0.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Description</div>
            <div className="text-sm leading-snug">
              {entry.description}
            </div>
          </div>
        )}

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

        {/* Scanner instructions */}
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-1.5">
          Scan found serials, then submit. Unscanned = Not Found
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
              : scanMessage.type === "cross-bin"
                ? "text-amber-800 bg-amber-100 border border-amber-200"
                : scanMessage.type === "unknown"
                  ? "text-red-800 bg-red-100 border border-red-200"
                  : "text-amber-800 bg-amber-100 border border-amber-200"
          }`}>
            {scanMessage.type === "success" ? "\u2713" : scanMessage.type === "unknown" ? "\u2717" : "\u2022"} {scanMessage.text}
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

        {/* Collapsible serial number list */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/50 hover:bg-muted transition-colors"
          >
            <span className="text-sm font-medium">
              {showList ? "Hide" : "Show"} serial list
            </span>
            <div className="flex items-center gap-2">
              {foundCount > 0 && (
                <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                  {foundCount} found
                </span>
              )}
              {notFoundCount > 0 && (
                <span className="text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                  {notFoundCount} not found
                </span>
              )}
              {showList ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </button>

          {showList && (
            <div className="space-y-2">
              {/* Filter input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter serials..."
                  className="pl-9 h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {filteredItems.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-3">
                    No serials match &ldquo;{filterText}&rdquo;
                  </div>
                ) : (
                  filteredItems.map((item) => (
                    <SerialRow
                      key={item.id}
                      item={item}
                      status={toggles[item.id]}
                      onToggle={() => toggleItem(item.id)}
                      isHighlighted={highlightedItemId === item.id}
                    />
                  ))
                )}
              </div>
              {filterText && filteredItems.length < entry.items.length && (
                <div className="text-xs text-muted-foreground text-center">
                  Showing {filteredItems.length} of {entry.items.length} serials
                </div>
              )}
            </div>
          )}
        </div>

        {/* Summary + Submit button */}
        <div className="text-center text-sm text-muted-foreground">
          {foundCount} found · {notFoundCount} not found
        </div>
        {restoredProgress && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-1.5">
            <RotateCcw className="h-3 w-3" />
            Progress restored from previous session
          </div>
        )}
        {/* Skip + Add note — above submit so they're visible */}
        <div className="flex items-center justify-between border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onSkip}
          >
            Skip
          </Button>

          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
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

        {/* Confirmation banner */}
        {showConfirm && notFoundCount > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
            <div className="text-sm font-medium text-red-800">
              {notFoundCount} serial{notFoundCount !== 1 ? "s" : ""} will be marked as Not Found
            </div>
            <div className="flex gap-2">
              <Button
                onClick={doSubmit}
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={isSubmitting}
              >
                Confirm Submit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Submit button */}
        {allFound ? (
          <Button
            onClick={handleSubmitClick}
            className="w-full h-14 text-lg font-bold text-white bg-green-600 hover:bg-green-700"
            disabled={isSubmitting}
          >
            All Match
          </Button>
        ) : allNotFound ? (
          <Button
            onClick={handleSubmitClick}
            className="w-full h-14 text-lg font-bold text-white bg-red-600 hover:bg-red-700"
            disabled={isSubmitting}
          >
            Submit All Not Found
          </Button>
        ) : (
          <Button
            onClick={handleSubmitClick}
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
            ? "border-green-200 bg-green-50"
            : "border-muted bg-muted/30 opacity-60"
      }`}
    >
      <span className={`font-mono text-sm flex-1 min-w-0 truncate ${status === "found" ? "text-green-800 font-semibold" : "text-muted-foreground"}`}>
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
