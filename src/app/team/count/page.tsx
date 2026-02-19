"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  CountItem,
  buildCountingQueue,
  groupReviewItems,
  type ReviewDisplayRow,
} from "@/components/counting/item-card";
import { SerializedGroupCard, type SerialGroupResult } from "@/components/counting/serialized-group-card";
import { BinCompleteBanner } from "@/components/counting/bin-complete-banner";
import { groupBinsByAisle, type BinEntry } from "@/lib/bin-utils";
import { ArrowLeft, CheckCircle2, Search, AlertTriangle, ChevronDown, ChevronRight, ChevronUp, PlayCircle, ClipboardCheck, ScanBarcode, Users, LayoutGrid, LayoutList, Layers } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/auth-context";
import { useSettings } from "@/contexts/settings-context";
import { markNotificationSeen } from "@/hooks/use-notifications";
import { saveCountLocally, markCountSynced, saveDiscrepancyLocally, markDiscrepancySynced } from "@/stores/offline-db";
import { feedbackMatch, feedbackVariance, feedbackBinComplete } from "@/lib/feedback";

type PageState = "loading" | "bin-selection" | "counting" | "complete" | "reviewing" | "recounting" | "verification-counting" | "serial-verification";

/** Normalize isMatch which can be boolean (server) or 0/1 (IndexedDB) */
function isMatchTrue(val: boolean | number | null | undefined): boolean {
  return val === true || val === 1;
}

interface SerialVerificationTask {
  id: number;
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  unknownSerials: string[];
  verificationAssignedAt: string | null;
}

interface VerificationItem {
  verificationId: number;
  countId: number;
  itemId: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  binNumber: string | null;
  warehouse: string | null;
  onHand: number | null;
  avgCost: number | null;
  totalValue: number | null;
  stockStatus: string | null;
  serialNumber: string | null;
  isSerialized: boolean | number | null;
  assignedAt: string;
}

function naturalCompare(a: string, b: string): number {
  const ax = a.match(/(\d+|\D+)/g) || [];
  const bx = b.match(/(\d+|\D+)/g) || [];
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    if (i >= ax.length) return -1;
    if (i >= bx.length) return 1;
    const an = parseInt(ax[i], 10);
    const bn = parseInt(bx[i], 10);
    if (!isNaN(an) && !isNaN(bn)) {
      if (an !== bn) return an - bn;
    } else {
      const cmp = ax[i].localeCompare(bx[i]);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

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

export default function CountingPage() {
  const { user } = useAuth();
  const { settings, updateSettings } = useSettings();
  const er = settings.easyRead;
  const sessionKey = `stocktake-last-bin-${user?.id ?? "unknown"}`;

  useEffect(() => {
    markNotificationSeen("verifications");
  }, []);

  // Data
  const [items, setItems] = useState<CountItem[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    counted: 0,
    progressPercent: 0,
  });
  const [members, setMembers] = useState<string[]>([]);

  // Page flow
  const [pageState, setPageState] = useState<PageState>("loading");
  const [selectedBin, setSelectedBin] = useState<string | null>(null);

  // Search + Review
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"contains" | "starts" | "exact" | "bin">("contains");
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [recountItem, setRecountItem] = useState<CountItem | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bin tabs
  type BinTab = "not-started" | "in-progress" | "completed" | "verification";
  const [binTab, setBinTab] = useState<BinTab>("not-started");
  const [completedFilter, setCompletedFilter] = useState<"all" | "variances" | "matched">("all");
  const [serializedOnly, setSerializedOnly] = useState(false);
  const [multiItemOnly, setMultiItemOnly] = useState(false);

  // Verification
  const [verificationItems, setVerificationItems] = useState<VerificationItem[]>([]);
  const [selectedVerificationBin, setSelectedVerificationBin] = useState<string | null>(null);
  const [verificationIndex, setVerificationIndex] = useState(0);
  const [verificationQtyValue, setVerificationQtyValue] = useState("");
  const [verificationComment, setVerificationComment] = useState("");

  // Serial verification tasks
  const [serialVerificationTasks, setSerialVerificationTasks] = useState<SerialVerificationTask[]>([]);
  const [activeSerialTask, setActiveSerialTask] = useState<SerialVerificationTask | null>(null);
  const [serialVerificationResults, setSerialVerificationResults] = useState<Record<string, "confirmed" | "not_found">>({});
  const [serialVerificationSubmitting, setSerialVerificationSubmitting] = useState(false);

  // Aisle collapse state
  const [collapsedAisles, setCollapsedAisles] = useState<Set<string>>(new Set());

  // Counting
  const [currentIndex, setCurrentIndex] = useState(0);
  const [qtyValue, setQtyValue] = useState("");
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showBinComplete, setShowBinComplete] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Resume banner
  const [resumeBin, setResumeBin] = useState<{ binName: string; remaining: number } | null>(null);

  // ---------- Load items ----------
  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/team/items");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setStats(data.stats || { total: 0, counted: 0, progressPercent: 0 });
        setVerificationItems(data.verificationItems || []);
        setSerialVerificationTasks(data.serialVerificationTasks || []);
        if (data.members) setMembers(data.members);
      }
    } catch {
      toast.error("Failed to load items");
    } finally {
      setPageState("bin-selection");
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // ---------- Check for resume bin on bin-selection load ----------
  useEffect(() => {
    if (pageState !== "bin-selection" || items.length === 0) return;
    try {
      const stored = sessionStorage.getItem(sessionKey);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      const binName = parsed?.binName;
      const timestamp = parsed?.timestamp;
      if (!binName || typeof timestamp !== "number") {
        sessionStorage.removeItem(sessionKey);
        return;
      }
      const fourHoursMs = 4 * 60 * 60 * 1000;
      if (Date.now() - timestamp > fourHoursMs) {
        sessionStorage.removeItem(sessionKey);
        return;
      }
      const pendingInBin = items.filter(
        (i) => i.countId === null && (binName === "No Bin" ? !i.binNumber : i.binNumber === binName)
      );
      if (pendingInBin.length > 0) {
        setResumeBin({ binName, remaining: pendingInBin.length });
      } else {
        sessionStorage.removeItem(sessionKey);
        setResumeBin(null);
      }
    } catch {
      setResumeBin(null);
    }
  }, [pageState, items, sessionKey]);

  // ---------- Auto-focus search on bin-selection ----------
  useEffect(() => {
    if (pageState !== "bin-selection") return;
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [pageState]);

  // ---------- Derived state ----------
  const binStats = useMemo(() => {
    const map = new Map<
      string,
      { total: number; pending: number; counted: number; matches: number; variances: number; supervisorEdited: number; serialized: number; lineItems: number }
    >();
    const binItemCodes = new Map<string, Set<string>>();
    for (const item of items) {
      const bin = item.binNumber || "No Bin";
      const entry = map.get(bin) || { total: 0, pending: 0, counted: 0, matches: 0, variances: 0, supervisorEdited: 0, serialized: 0, lineItems: 0 };
      entry.total++;
      if (item.isSerialized === 1 || item.isSerialized === true) {
        entry.serialized++;
      }
      if (item.countId === null) {
        entry.pending++;
      } else {
        entry.counted++;
        if (item.variance === 0 || isMatchTrue(item.isMatch)) {
          entry.matches++;
        } else {
          entry.variances++;
        }
        if (item.checkStatus === "accepted") {
          entry.supervisorEdited++;
        }
      }
      map.set(bin, entry);
      // Track unique item codes per bin for line item count
      if (!binItemCodes.has(bin)) binItemCodes.set(bin, new Set());
      binItemCodes.get(bin)!.add(item.itemCode);
    }
    // Set lineItems count from unique item codes
    binItemCodes.forEach((codes, bin) => {
      const entry = map.get(bin);
      if (entry) entry.lineItems = codes.size;
    });
    const entries = Array.from(map.entries());
    entries.sort(([a, aStats], [b, bStats]) => {
      const aComplete = aStats.pending === 0 ? 1 : 0;
      const bComplete = bStats.pending === 0 ? 1 : 0;
      if (aComplete !== bComplete) return aComplete - bComplete;
      if (aComplete === 1 && bComplete === 1) {
        if (aStats.variances !== bStats.variances) return bStats.variances - aStats.variances;
      }
      return naturalCompare(a, b);
    });
    return entries;
  }, [items]);

  const pendingItems = useMemo(() => {
    let filtered = items.filter((i) => i.countId === null);
    if (selectedBin && selectedBin !== "all") {
      filtered = filtered.filter((i) =>
        selectedBin === "No Bin" ? !i.binNumber : i.binNumber === selectedBin
      );
    }
    return filtered;
  }, [items, selectedBin]);

  const countingQueue = useMemo(
    () => buildCountingQueue(pendingItems),
    [pendingItems]
  );

  const currentEntry = countingQueue[currentIndex] ?? null;
  const currentItem = currentEntry?.type === "single" ? currentEntry.item : null;

  const upcomingEntries = useMemo(
    () => countingQueue.filter((_, i) => i !== currentIndex),
    [countingQueue, currentIndex]
  );

  const scopedStats = useMemo(() => {
    let scoped: CountItem[];
    if (!selectedBin || selectedBin === "all") {
      scoped = items;
    } else {
      scoped = items.filter((i) =>
        selectedBin === "No Bin" ? !i.binNumber : i.binNumber === selectedBin
      );
    }
    const total = scoped.length;
    const counted = scoped.filter((i) => i.countId !== null).length;
    const pending = total - counted;
    const percent = total > 0 ? Math.round((counted / total) * 100) : 0;
    return { total, counted, pending, percent };
  }, [items, selectedBin]);

  // ---------- Search results ----------
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();

    const matchField = (val: string | null | undefined): boolean => {
      if (!val) return false;
      const v = val.toLowerCase();
      switch (searchMode) {
        case "starts":
          return v.startsWith(q);
        case "exact":
          return v === q;
        case "bin":
          return false;
        case "contains":
        default:
          return v.includes(q);
      }
    };

    if (searchMode === "bin") {
      return items.filter((i) => {
        const bin = (i.binNumber || "").toLowerCase();
        return bin.startsWith(q) || bin === q;
      });
    }

    return items.filter(
      (i) => matchField(i.itemCode) || matchField(i.description)
    );
  }, [items, search, searchMode]);

  // ---------- Split bins into not-started / in-progress / completed ----------
  const notStartedBins = useMemo(
    () => binStats.filter(([, s]) => s.counted === 0 && (!serializedOnly || s.serialized > 0) && (!multiItemOnly || s.lineItems > 1)),
    [binStats, serializedOnly, multiItemOnly]
  );
  const inProgressBins = useMemo(
    () => binStats.filter(([, s]) => s.counted > 0 && s.pending > 0 && (!serializedOnly || s.serialized > 0) && (!multiItemOnly || s.lineItems > 1)),
    [binStats, serializedOnly, multiItemOnly]
  );
  const completedBins = useMemo(
    () => binStats.filter(([, s]) => s.pending === 0 && (!serializedOnly || s.serialized > 0) && (!multiItemOnly || s.lineItems > 1)),
    [binStats, serializedOnly, multiItemOnly]
  );
  const filteredCompletedBins = useMemo(() => {
    if (completedFilter === "variances") return completedBins.filter(([, s]) => s.variances > 0);
    if (completedFilter === "matched") return completedBins.filter(([, s]) => s.variances === 0);
    return completedBins;
  }, [completedBins, completedFilter]);

  // ---------- Aisle-grouped bins ----------
  const groupedNotStarted = useMemo(() => groupBinsByAisle(notStartedBins as BinEntry[]), [notStartedBins]);
  const groupedInProgress = useMemo(() => groupBinsByAisle(inProgressBins as BinEntry[]), [inProgressBins]);
  const groupedCompleted = useMemo(() => groupBinsByAisle(filteredCompletedBins as BinEntry[]), [filteredCompletedBins]);

  // Verification items grouped by bin
  const verificationBinStats = useMemo(() => {
    const map = new Map<string, { total: number; items: VerificationItem[] }>();
    for (const vi of verificationItems) {
      const bin = vi.binNumber || "No Bin";
      const entry = map.get(bin) || { total: 0, items: [] };
      entry.total++;
      entry.items.push(vi);
      map.set(bin, entry);
    }
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => naturalCompare(a, b));
    return entries;
  }, [verificationItems]);

  // Scoped verification items (filtered to selected bin)
  const scopedVerificationItems = useMemo(() => {
    if (!selectedVerificationBin) return verificationItems;
    return verificationItems.filter((vi) => {
      const bin = vi.binNumber || "No Bin";
      return bin === selectedVerificationBin;
    });
  }, [verificationItems, selectedVerificationBin]);

  // Verification queue: groups serialized verification items by itemCode
  type VerificationQueueEntry =
    | { type: "single"; item: VerificationItem }
    | { type: "serialized-group"; itemCode: string; description: string | null;
        brand: string | null; stockStatus: string | null; items: VerificationItem[] };

  const verificationQueue = useMemo((): VerificationQueueEntry[] => {
    const queue: VerificationQueueEntry[] = [];
    const serialGroupMap = new Map<string, VerificationItem[]>();
    const usedSerialCodes = new Set<string>();

    for (const vi of scopedVerificationItems) {
      const isSerialized = vi.isSerialized === true || vi.isSerialized === 1;
      if (isSerialized) {
        if (!serialGroupMap.has(vi.itemCode)) {
          serialGroupMap.set(vi.itemCode, []);
        }
        serialGroupMap.get(vi.itemCode)!.push(vi);
      }
    }

    for (const vi of scopedVerificationItems) {
      const isSerialized = vi.isSerialized === true || vi.isSerialized === 1;
      if (isSerialized) {
        if (usedSerialCodes.has(vi.itemCode)) continue;
        usedSerialCodes.add(vi.itemCode);
        const groupItems = serialGroupMap.get(vi.itemCode)!;
        queue.push({
          type: "serialized-group",
          itemCode: vi.itemCode,
          description: groupItems[0].description,
          brand: groupItems[0].brand,
          stockStatus: groupItems[0].stockStatus,
          items: groupItems,
        });
      } else {
        queue.push({ type: "single", item: vi });
      }
    }
    return queue;
  }, [scopedVerificationItems]);

  // Helper: convert VerificationItem to CountItem for SerializedGroupCard
  function verificationItemToCountItem(vi: VerificationItem): CountItem {
    return {
      id: vi.itemId,
      itemCode: vi.itemCode,
      description: vi.description,
      brand: vi.brand,
      binNumber: vi.binNumber,
      binInternalId: null,
      onHand: vi.onHand,
      avgCost: vi.avgCost,
      stockStatus: vi.stockStatus,
      serialNumber: vi.serialNumber,
      isSerialized: vi.isSerialized,
      countId: null,
      countedQty: null,
      variance: null,
      isMatch: null,
      comment: null,
      checkStatus: null,
      countedAt: null,
    };
  }

  // Auto-select first tab that has bins (verification highest priority)
  useEffect(() => {
    if (pageState !== "bin-selection") return;
    if (verificationItems.length > 0 || serialVerificationTasks.length > 0) {
      setBinTab("verification");
    } else if (inProgressBins.length > 0) {
      setBinTab("in-progress");
    } else if (notStartedBins.length > 0) {
      setBinTab("not-started");
    } else if (completedBins.length > 0) {
      setBinTab("completed");
    }
  }, [pageState, notStartedBins.length, inProgressBins.length, completedBins.length, verificationItems.length, serialVerificationTasks.length]);

  // ---------- Review items (all items in selected bin) ----------
  const reviewItems = useMemo(() => {
    if (!selectedBin) return [];
    if (selectedBin === "all") return items;
    return items.filter((i) =>
      selectedBin === "No Bin" ? !i.binNumber : i.binNumber === selectedBin
    );
  }, [items, selectedBin]);

  const groupedReviewItems = useMemo(
    () => groupReviewItems(reviewItems),
    [reviewItems]
  );

  // ---------- Auto-fill qty when currentItem changes (single items only) ----------
  const currentItemId = currentItem?.id;
  useEffect(() => {
    if (pageState !== "counting" || currentItem == null) return;
    setQtyValue(String(currentItem.onHand ?? 0));
  }, [currentItemId, pageState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Index clamping + completion detection ----------
  useEffect(() => {
    if (pageState !== "counting") return;
    if (showFlash) return; // Wait for flash to finish before detecting completion
    if (countingQueue.length === 0) {
      // Show bin complete banner
      setShowBinComplete(true);
      return;
    }
    if (currentIndex >= countingQueue.length) {
      setCurrentIndex(0);
    }
  }, [countingQueue.length, currentIndex, pageState, showFlash]);

  // ---------- Auto-focus + select (single items only) ----------
  useEffect(() => {
    if ((pageState !== "counting" && pageState !== "recounting") || (pageState === "counting" && currentItemId == null) || (pageState === "recounting" && !recountItem)) return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentItemId, recountItem?.id, pageState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Keyboard handler ----------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Don't intercept when typing in textarea
      if (target.tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        if (pageState === "bin-selection" && search) {
          e.preventDefault();
          setSearch("");
          return;
        }
        if (pageState === "counting") {
          e.preventDefault();
          if (currentEntry?.type === "serialized-group") {
            // Serialized groups: Esc always goes back to bin selection
            goBackToBinSelection();
          } else {
            const onHandStr = String(currentItem?.onHand ?? 0);
            if (qtyValue !== onHandStr && qtyValue !== "") {
              // First Esc: reset to on-hand
              setQtyValue(onHandStr);
              inputRef.current?.select();
            } else {
              // Second Esc (or empty): go back
              goBackToBinSelection();
            }
          }
          return;
        }
        if (pageState === "recounting") {
          e.preventDefault();
          setRecountItem(null);
          setQtyValue("");
          setComment("");
          setPageState("reviewing");
          return;
        }
        if (pageState === "reviewing") {
          e.preventDefault();
          goBackToBinSelection();
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pageState, qtyValue, search, recountItem, currentItem, currentEntry]);

  // ---------- Core functions ----------
  const handleCount = useCallback(
    async (itemId: number, qty: number, countComment?: string, silent?: boolean) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;

      // Block changes to items reviewed by supervisor
      if (item.checkStatus === "accepted") {
        if (!silent) toast.error("This item has been reviewed by a supervisor and cannot be changed");
        return;
      }

      // Block changes to items with pending verification
      if (item.hasPendingVerification) {
        if (!silent) toast.error("This item has a pending verification and cannot be edited");
        return;
      }

      const clientId = uuidv4();
      const onHand = item.onHand ?? 0;
      const variance = qty - onHand;
      const isMatch = variance === 0;
      const countedAt = new Date().toISOString();

      // Save to IndexedDB FIRST so data survives network failures / browser close
      try {
        await saveCountLocally({
          clientId,
          itemId,
          countedQty: qty,
          isMatch,
          comment: countComment || null,
          countedAt,
        });
      } catch {
        // IndexedDB unavailable — continue with server POST anyway
      }

      // Optimistic UI update
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                countId: i.countId || -1,
                countedQty: qty,
                variance,
                isMatch,
                comment: countComment || i.comment,
                countedAt,
              }
            : i
        )
      );
      if (!item.countId) {
        setStats((prev) => ({
          ...prev,
          counted: prev.counted + 1,
          progressPercent:
            prev.total > 0
              ? Math.round(((prev.counted + 1) / prev.total) * 100)
              : 0,
        }));
      }

      // Try to sync to server immediately
      try {
        const res = await fetch("/api/team/count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            countedQty: qty,
            isMatch,
            comment: countComment,
            clientId,
          }),
        });

        if (!res.ok) throw new Error("Failed to save");

        const data = await res.json();

        // Mark as synced in IndexedDB
        try {
          await markCountSynced(clientId);
        } catch {
          // IndexedDB unavailable — server has the data, acceptable
        }

        if (data.count) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    countId: data.count.id,
                    countedQty: data.count.countedQty,
                    variance: data.count.variance,
                    isMatch: data.count.isMatch,
                    comment: data.count.comment,
                    countedAt: data.count.countedAt,
                  }
                : i
            )
          );
        }

        if (!isMatch && !silent) {
          toast.warning(`Variance: ${variance > 0 ? "+" : ""}${variance}`);
        }
      } catch {
        // Network failed — count is safely in IndexedDB, useSync will retry
        if (!silent) toast.info("Saved offline — will sync when back online");
      }
    },
    [items]
  );

  const submitCount = useCallback(() => {
    if (!currentItem || isSubmittingRef.current) return;
    const qty = parseFloat(qtyValue);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    const isMatch = qty === (currentItem.onHand ?? 0);
    handleCount(currentItem.id, qty, comment || undefined).finally(() => {
      setShowFlash(true);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      if (isMatch) {
        feedbackMatch(settings.hapticFeedback);
      } else {
        feedbackVariance(settings.hapticFeedback);
      }
    });
  }, [currentItem, qtyValue, comment, handleCount, settings.hapticFeedback]);

  const handleFlashComplete = useCallback(() => {
    setShowFlash(false);
    setComment("");
    window.scrollTo({ top: 0 });
  }, []);

  const submitSerializedGroup = useCallback(
    async (results: SerialGroupResult[], unknownSerials?: string[]) => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      try {
        // Submit all serials silently (no individual toasts)
        await Promise.all(
          results.map(({ itemId, qty }) =>
            handleCount(itemId, qty, comment || undefined, true)
          )
        );

        // Show consolidated summary toast
        const found = results.filter((r) => r.qty > 0).length;
        const notFound = results.filter((r) => r.qty === 0).length;
        if (notFound > 0) {
          toast.warning(`${found} found, ${notFound} not found (${notFound > found ? "-" : "+"}${Math.abs(found - results.length)} variance)`);
        } else {
          toast.success(`All ${found} serials matched`);
        }

        // Send unknown serials as a single discrepancy record to supervisor
        if (unknownSerials && unknownSerials.length > 0 && currentEntry?.type === "serialized-group") {
          const discClientId = crypto.randomUUID();
          const discData = {
            itemCode: currentEntry.itemCode,
            description: currentEntry.description || null,
            binNumber: selectedBin === "No Bin" ? null : selectedBin,
            binInternalId: currentEntry.items[0]?.binInternalId || null,
            unknownSerials,
          };

          // Save to IndexedDB first so data survives offline/browser close
          try {
            await saveDiscrepancyLocally({
              clientId: discClientId,
              ...discData,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // IndexedDB unavailable — continue with POST
          }

          try {
            const res = await fetch("/api/team/serial-discrepancies", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(discData),
            });
            if (!res.ok) throw new Error("Failed");
            try { await markDiscrepancySynced(discClientId); } catch { /* ok */ }
            toast.info(`${unknownSerials.length} unknown serial(s) sent to supervisor for review`);
          } catch {
            toast.info(`${unknownSerials.length} unknown serial(s) saved — will send to supervisor when online`);
          }
        }

        setShowFlash(true);
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, handleCount, comment, currentEntry, selectedBin]
  );

  const skipItem = useCallback(() => {
    if (countingQueue.length === 0) return;
    setCurrentIndex((i) => (i + 1) % countingQueue.length);
    setQtyValue("");
    setComment("");
    setQueueSearch("");
    window.scrollTo({ top: 0 });
  }, [countingQueue.length]);

  const jumpToEntry = useCallback((queueIndex: number) => {
    if (queueIndex < 0 || queueIndex >= countingQueue.length) return;
    setCurrentIndex(queueIndex);
    setQtyValue("");
    setComment("");
    setQueueSearch("");
    window.scrollTo({ top: 0 });
  }, [countingQueue.length]);

  const selectBin = useCallback(
    (bin: string) => {
      setSelectedBin(bin);
      setCurrentIndex(0);
      setQtyValue("");
      setComment("");
      setShowFlash(false);
      setShowBinComplete(false);
      setSearch("");
      setQueueSearch("");
      setRecountItem(null);

      // Save to sessionStorage for resume
      try {
        sessionStorage.setItem(sessionKey, JSON.stringify({ binName: bin, timestamp: Date.now() }));
      } catch { /* ignore */ }

      // Check if there are pending items in this bin
      let pending: CountItem[];
      if (bin === "all") {
        pending = items.filter((i) => i.countId === null);
      } else {
        pending = items.filter(
          (i) =>
            i.countId === null &&
            (bin === "No Bin" ? !i.binNumber : i.binNumber === bin)
        );
      }

      setPageState(pending.length > 0 ? "counting" : "reviewing");
    },
    [items]
  );

  function goBackToBinSelection() {
    setSelectedBin(null);
    setPageState("bin-selection");
    setQtyValue("");
    setComment("");
    setShowFlash(false);
    setShowBinComplete(false);
    setCurrentIndex(0);
    setRecountItem(null);
  }

  // ---------- Verification counting ----------
  const currentVerificationEntry_q = verificationQueue[verificationIndex] ?? null;
  const currentVerificationItem = currentVerificationEntry_q?.type === "single" ? currentVerificationEntry_q.item : null;

  const startVerificationCounting = useCallback((bin: string) => {
    setSelectedVerificationBin(bin);
    setVerificationIndex(0);
    setVerificationComment("");
    setShowFlash(false);
    // Auto-fill qty only for the first non-serialized item
    const scoped = verificationItems.filter((vi) => (vi.binNumber || "No Bin") === bin);
    const firstNonSerialized = scoped.find((vi) => !(vi.isSerialized === true || vi.isSerialized === 1));
    if (firstNonSerialized) {
      setVerificationQtyValue(String(firstNonSerialized.onHand ?? 0));
    } else {
      setVerificationQtyValue("");
    }
    setPageState("verification-counting");
  }, [verificationItems]);

  const submitVerificationCount = useCallback(async () => {
    if (!currentVerificationItem || isSubmitting) return;
    const qty = parseFloat(verificationQtyValue);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    setIsSubmitting(true);
    const clientId = uuidv4();
    const isMatch = qty === (currentVerificationItem.onHand ?? 0);

    // Save to IndexedDB first so data survives network failures
    try {
      await saveCountLocally({
        clientId,
        itemId: currentVerificationItem.itemId,
        countedQty: qty,
        isMatch,
        comment: verificationComment || null,
        countedAt: new Date().toISOString(),
      });
    } catch {
      // IndexedDB unavailable — continue with server POST
    }

    try {
      const res = await fetch("/api/team/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: currentVerificationItem.itemId,
          countedQty: qty,
          isMatch,
          comment: verificationComment || undefined,
          clientId,
          verificationId: currentVerificationItem.verificationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to submit verification");
        return;
      }

      // Mark as synced in IndexedDB
      try { await markCountSynced(clientId); } catch { /* ok */ }

      const onHand = currentVerificationItem.onHand ?? 0;
      const variance = qty - onHand;
      if (variance !== 0) {
        toast.warning(`Variance: ${variance > 0 ? "+" : ""}${variance}`);
      }

      // Check if this was the last item in the bin before removing
      const remainingInBin = scopedVerificationItems.filter(
        (v) => v.verificationId !== currentVerificationItem.verificationId
      );

      // Remove completed item from list
      setVerificationItems((prev) =>
        prev.filter((v) => v.verificationId !== currentVerificationItem.verificationId)
      );

      if (remainingInBin.length === 0) {
        // Last item in this bin — go straight back to bin list
        toast.success("All verifications in this bin complete!");
        setSelectedVerificationBin(null);
        setVerificationIndex(0);
        setShowFlash(false);
        setPageState("bin-selection");
        // Check if there are still items in other bins
        const totalRemaining = verificationItems.filter(
          (v) => v.verificationId !== currentVerificationItem.verificationId
        );
        if (totalRemaining.length > 0) {
          setBinTab("verification");
        }
        return;
      }

      // Show flash for next item
      setShowFlash(true);
    } catch {
      toast.error("Failed to submit — check your connection");
    } finally {
      setIsSubmitting(false);
    }
  }, [currentVerificationItem, verificationQtyValue, verificationComment, isSubmitting]);

  // Submit serialized verification group (uses SerializedGroupCard)
  const submitSerializedVerificationGroup = useCallback(
    async (results: SerialGroupResult[], unknownSerials?: string[]) => {
      if (isSubmitting) return;
      setIsSubmitting(true);

      const currentEntry = verificationQueue[verificationIndex];
      if (!currentEntry || currentEntry.type !== "serialized-group") {
        setIsSubmitting(false);
        return;
      }

      try {
        // Submit each serial's verification count with offline fallback
        const submitResults = await Promise.all(
          results.map(async ({ itemId, qty }) => {
            const vi = currentEntry.items.find((v) => v.itemId === itemId);
            if (!vi) return { success: false, itemId };

            const onHand = vi.onHand ?? 0;
            const cid = uuidv4();
            const isMatch = qty === onHand;

            // Save to IndexedDB first
            try {
              await saveCountLocally({
                clientId: cid,
                itemId,
                countedQty: qty,
                isMatch,
                comment: null,
                countedAt: new Date().toISOString(),
              });
            } catch { /* IndexedDB unavailable */ }

            try {
              const res = await fetch("/api/team/count", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  itemId,
                  countedQty: qty,
                  isMatch,
                  clientId: cid,
                  verificationId: vi.verificationId,
                }),
              });
              if (res.ok) {
                try { await markCountSynced(cid); } catch { /* ok */ }
                return { success: true, itemId };
              }
              return { success: false, itemId };
            } catch {
              return { success: false, itemId };
            }
          })
        );

        const failedCount = submitResults.filter(r => r && !r.success).length;
        if (failedCount > 0) {
          toast.info(`${failedCount} verification(s) saved offline — will sync when back online`);
        }

        // Show consolidated summary toast
        const found = results.filter((r) => r.qty > 0).length;
        const notFound = results.filter((r) => r.qty === 0).length;
        if (notFound > 0) {
          toast.warning(`Verification: ${found} found, ${notFound} not found`);
        } else {
          toast.success(`All ${found} serials verified`);
        }

        // Send unknown serials as discrepancy
        if (unknownSerials && unknownSerials.length > 0) {
          const discClientId = crypto.randomUUID();
          const discData = {
            itemCode: currentEntry.itemCode,
            description: currentEntry.description || null,
            binNumber: selectedVerificationBin === "No Bin" ? null : selectedVerificationBin,
            binInternalId: null,
            unknownSerials,
          };

          // Save to IndexedDB first so data survives offline/browser close
          try {
            await saveDiscrepancyLocally({
              clientId: discClientId,
              ...discData,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // IndexedDB unavailable — continue with POST
          }

          try {
            const res = await fetch("/api/team/serial-discrepancies", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(discData),
            });
            if (!res.ok) throw new Error("Failed");
            try { await markDiscrepancySynced(discClientId); } catch { /* ok */ }
            toast.info(`${unknownSerials.length} unknown serial(s) sent to supervisor for review`);
          } catch {
            toast.info(`${unknownSerials.length} unknown serial(s) saved — will send to supervisor when online`);
          }
        }

        // Remove completed items from verification list
        const completedItemIds = new Set(currentEntry.items.map((v) => v.verificationId));
        setVerificationItems((prev) =>
          prev.filter((v) => !completedItemIds.has(v.verificationId))
        );

        // Check if bin is complete
        const remainingInBin = scopedVerificationItems.filter(
          (v) => !completedItemIds.has(v.verificationId)
        );

        if (remainingInBin.length === 0) {
          toast.success("All verifications in this bin complete!");
          setSelectedVerificationBin(null);
          setVerificationIndex(0);
          setShowFlash(false);
          setPageState("bin-selection");
          const totalRemaining = verificationItems.filter(
            (v) => !completedItemIds.has(v.verificationId)
          );
          if (totalRemaining.length > 0) {
            setBinTab("verification");
          }
        } else {
          setShowFlash(true);
        }
      } catch {
        toast.error("Failed to submit — check your connection");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, verificationQueue, verificationIndex, selectedVerificationBin, scopedVerificationItems, verificationItems]
  );

  // Auto-advance verification after flash
  useEffect(() => {
    if (pageState !== "verification-counting") return;
    if (showFlash) return;
    if (verificationQueue.length === 0) {
      toast.success("All verifications in this bin complete!");
      setSelectedVerificationBin(null);
      setPageState("bin-selection");
      setShowFlash(false);
      setVerificationIndex(0);
      if (verificationItems.length > 0) {
        setBinTab("verification");
      }
      return;
    }
    if (verificationIndex >= verificationQueue.length) {
      setVerificationIndex(0);
    }
    const entry = verificationQueue[verificationIndex];
    if (entry && entry.type === "single") {
      setVerificationQtyValue(String(entry.item.onHand ?? 0));
      setVerificationComment("");
    }
  }, [verificationQueue.length, verificationIndex, pageState, showFlash]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus for verification (single items only)
  useEffect(() => {
    if (pageState !== "verification-counting") return;
    const entry = verificationQueue[verificationIndex];
    if (!entry || entry.type !== "single") return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [verificationQueue, verificationIndex, pageState]);

  const handleBinCompleteFinish = useCallback(() => {
    setShowFlash(false);
    setShowBinComplete(false);
    setSelectedBin(null);
    setPageState("bin-selection");
    setCurrentIndex(0);
    feedbackBinComplete(settings.hapticFeedback);
    try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }
  }, [settings.hapticFeedback]);

  // ---------- Recount via full ActiveItemCard ----------
  const startRecount = useCallback((item: CountItem) => {
    if (item.checkStatus === "accepted") {
      toast.error("This item has been reviewed by a supervisor and cannot be changed");
      return;
    }
    if (item.hasPendingVerification) {
      toast.error("This item has a pending verification and cannot be edited");
      return;
    }
    setRecountItem(item);
    setQtyValue(item.countedQty != null ? String(item.countedQty) : String(item.onHand ?? 0));
    setComment("");
    setShowFlash(false);
    setPageState("recounting");
  }, []);

  const submitRecount = useCallback(() => {
    if (!recountItem || isSubmitting) return;
    const qty = parseFloat(qtyValue);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }
    setIsSubmitting(true);
    handleCount(recountItem.id, qty, comment || undefined).finally(() => {
      setIsSubmitting(false);
      setRecountItem(null);
      setQtyValue("");
      setComment("");
      setPageState("reviewing");
    });
  }, [recountItem, qtyValue, comment, isSubmitting, handleCount]);

  const cancelRecount = useCallback(() => {
    setRecountItem(null);
    setQtyValue("");
    setComment("");
    setPageState("reviewing");
  }, []);

  // ---------- Aisle toggle helper ----------
  const toggleAisle = useCallback((prefix: string) => {
    setCollapsedAisles((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
      }
      return next;
    });
  }, []);

  const collapseAllAisles = useCallback((groups: ReturnType<typeof groupBinsByAisle>, variant: string) => {
    setCollapsedAisles((prev) => {
      const next = new Set(prev);
      for (const group of groups) {
        next.add(`${variant}-${group.prefix}`);
      }
      return next;
    });
  }, []);

  const expandAllAisles = useCallback((groups: ReturnType<typeof groupBinsByAisle>, variant: string) => {
    setCollapsedAisles((prev) => {
      const next = new Set(prev);
      for (const group of groups) {
        next.delete(`${variant}-${group.prefix}`);
      }
      return next;
    });
  }, []);

  // ---------- Render helpers ----------
  function renderBinButton(bin: string, bStats: { total: number; pending: number; counted: number; matches: number; variances: number; supervisorEdited: number; serialized: number; lineItems: number }, variant: "not-started" | "in-progress" | "completed") {
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

  function renderBinListItem(bin: string, bStats: { total: number; pending: number; counted: number; matches: number; variances: number; supervisorEdited: number; serialized: number; lineItems: number }, variant: "not-started" | "in-progress" | "completed") {
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

  function renderAisleGroupedBins(
    groups: ReturnType<typeof groupBinsByAisle>,
    variant: "not-started" | "in-progress" | "completed"
  ) {
    const hasMultipleGroups = groups.length > 1;
    const isListMode = settings.binViewMode === "list";

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
                {group.bins.map(([bin, bStats]) => renderBinListItem(bin, bStats, variant))}
              </div>
            ) : (
              <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {group.bins.map(([bin, bStats]) => renderBinButton(bin, bStats, variant))}
              </div>
            )
          )}
        </div>
      );
    });
  }

  // ---------- Loading ----------
  if (pageState === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading items...</div>
      </div>
    );
  }

  // ---------- Bin Complete Banner ----------
  if (showBinComplete) {
    return (
      <BinCompleteBanner
        binName={selectedBin === "all" ? "All Bins" : selectedBin || "Bin"}
        onComplete={handleBinCompleteFinish}
      />
    );
  }

  // ---------- Verification Counting ----------
  if (pageState === "verification-counting") {
    const currentVerificationEntry = verificationQueue[verificationIndex] ?? null;

    if (!currentVerificationEntry) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">No verification items</div>
        </div>
      );
    }

    const upcomingVerificationEntries = verificationQueue.filter((_, i) => i !== verificationIndex);

    return (
      <div className="flex flex-col h-[calc(100vh-7.5rem)]">
        {/* Sticky header */}
        <div className="sticky top-14 z-40 bg-purple-50 border-b border-purple-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedVerificationBin(null);
                goBackToBinSelection();
              }}
              className="px-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Badge className="bg-purple-100 text-purple-800 border-purple-300">
              Verification
            </Badge>
            <span className="font-mono font-semibold text-sm">
              {selectedVerificationBin || "All"}
            </span>
            <span className="text-sm text-muted-foreground">
              {scopedVerificationItems.length} remaining
            </span>
          </div>
        </div>

        {/* Main content — extra pb for sticky action bar */}
        <div className="flex-1 overflow-y-auto p-4 pb-52 space-y-4">
          <div className="max-w-lg mx-auto">
            {currentVerificationEntry.type === "serialized-group" ? (
              <SerializedGroupCard
                key={`ver-serial-${currentVerificationEntry.itemCode}`}
                entry={{
                  type: "serialized-group",
                  itemCode: currentVerificationEntry.itemCode,
                  description: currentVerificationEntry.description,
                  brand: currentVerificationEntry.brand,
                  stockStatus: currentVerificationEntry.stockStatus,
                  items: currentVerificationEntry.items.map(verificationItemToCountItem),
                }}
                onSubmitAll={submitSerializedVerificationGroup}
                onSkip={() => {
                  if (verificationQueue.length <= 1) return;
                  setVerificationIndex((i) => (i + 1) % verificationQueue.length);
                }}
                isSubmitting={isSubmitting}
                showSuccessFlash={showFlash}
                onFlashComplete={handleFlashComplete}
                comment={verificationComment}
                onCommentChange={setVerificationComment}
              />
            ) : (
              <ActiveItemCard
                item={verificationItemToCountItem(currentVerificationEntry.item)}
                qtyValue={verificationQtyValue}
                onQtyChange={setVerificationQtyValue}
                onSubmit={submitVerificationCount}
                onSkip={() => {
                  if (verificationQueue.length <= 1) return;
                  setVerificationIndex((i) => (i + 1) % verificationQueue.length);
                }}
                comment={verificationComment}
                onCommentChange={setVerificationComment}
                inputRef={inputRef}
                isSubmitting={isSubmitting}
                showSuccessFlash={showFlash}
                onFlashComplete={handleFlashComplete}
                isVerification
              />
            )}
          </div>

          {/* Remaining verification entries in this bin */}
          {upcomingVerificationEntries.length > 0 && (
            <div className="max-w-lg mx-auto">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Up Next ({upcomingVerificationEntries.length} more)
              </div>
              <Card>
                <div className="max-h-[300px] overflow-y-auto">
                  <CardContent className="p-0">
                    {upcomingVerificationEntries.slice(0, 20).map((entry, i) =>
                      entry.type === "serialized-group" ? (
                        <QueueGroupRow
                          key={`ver-group-${entry.itemCode}`}
                          entry={{
                            type: "serialized-group",
                            itemCode: entry.itemCode,
                            description: entry.description,
                            brand: entry.brand,
                            stockStatus: entry.stockStatus,
                            items: entry.items.map(verificationItemToCountItem),
                          }}
                          position={i + 1}
                        />
                      ) : (
                        <QueueItemRow
                          key={entry.item.verificationId}
                          item={verificationItemToCountItem(entry.item)}
                          position={i + 1}
                        />
                      )
                    )}
                  </CardContent>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Serial Verification ----------
  if (pageState === "serial-verification" && activeSerialTask) {
    const allMarked = activeSerialTask.unknownSerials.every(
      (s) => serialVerificationResults[s] !== undefined
    );

    const handleSerialVerificationSubmit = async () => {
      if (!allMarked) {
        toast.error("Please mark all serials before submitting");
        return;
      }

      setSerialVerificationSubmitting(true);
      try {
        const verifiedSerials = activeSerialTask.unknownSerials.map((serial) => ({
          serial,
          status: serialVerificationResults[serial],
        }));

        const res = await fetch("/api/team/serial-discrepancies", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discrepancyId: activeSerialTask.id,
            verifiedSerials,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "Failed to submit verification");
          return;
        }

        toast.success("Serial verification submitted");
        setSerialVerificationTasks((prev) =>
          prev.filter((t) => t.id !== activeSerialTask.id)
        );
        setActiveSerialTask(null);
        setSerialVerificationResults({});
        setPageState("bin-selection");
        if (serialVerificationTasks.length > 1 || verificationItems.length > 0) {
          setBinTab("verification");
        }
      } catch {
        toast.error("Failed — check your connection");
      } finally {
        setSerialVerificationSubmitting(false);
      }
    };

    const toggleSerialResult = (serial: string, status: "confirmed" | "not_found") => {
      setSerialVerificationResults((prev) => {
        if (prev[serial] === status) {
          const next = { ...prev };
          delete next[serial];
          return next;
        }
        return { ...prev, [serial]: status };
      });
    };

    const confirmedCount = activeSerialTask.unknownSerials.filter(
      (s) => serialVerificationResults[s] === "confirmed"
    ).length;
    const notFoundCount = activeSerialTask.unknownSerials.filter(
      (s) => serialVerificationResults[s] === "not_found"
    ).length;
    const unmarkedCount = activeSerialTask.unknownSerials.length - confirmedCount - notFoundCount;

    return (
      <div className="flex flex-col h-[calc(100vh-7.5rem)]">
        {/* Sticky header */}
        <div className="sticky top-14 z-40 bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActiveSerialTask(null);
                setSerialVerificationResults({});
                setPageState("bin-selection");
              }}
              className="px-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Badge className="bg-amber-100 text-amber-800 border-amber-300">
              Serial Verification
            </Badge>
            <span className="font-mono font-semibold text-sm">
              {activeSerialTask.itemCode}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 pl-9 text-xs text-muted-foreground">
            {activeSerialTask.binNumber && (
              <span>Bin: <span className="font-mono font-medium">{activeSerialTask.binNumber}</span></span>
            )}
            <span>{activeSerialTask.unknownSerials.length} serial{activeSerialTask.unknownSerials.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-lg mx-auto space-y-4">
            {/* Description */}
            {activeSerialTask.description && (
              <div className="text-sm text-muted-foreground">
                {activeSerialTask.description}
              </div>
            )}

            {/* Progress summary */}
            <div className="flex items-center gap-2 text-xs">
              {confirmedCount > 0 && (
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  {confirmedCount} confirmed
                </Badge>
              )}
              {notFoundCount > 0 && (
                <Badge className="bg-red-100 text-red-800 border-red-300">
                  {notFoundCount} not found
                </Badge>
              )}
              {unmarkedCount > 0 && (
                <Badge variant="secondary">
                  {unmarkedCount} remaining
                </Badge>
              )}
            </div>

            {/* Serial list */}
            <div className="space-y-2">
              {activeSerialTask.unknownSerials.map((serial) => {
                const result = serialVerificationResults[serial];
                return (
                  <Card key={serial} className={`${
                    result === "confirmed"
                      ? "border-green-300 bg-green-50/50"
                      : result === "not_found"
                        ? "border-red-300 bg-red-50/50"
                        : ""
                  }`}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-bold text-sm">
                            {serial}
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant={result === "confirmed" ? "default" : "outline"}
                            className={`h-9 text-xs ${
                              result === "confirmed"
                                ? "bg-green-600 hover:bg-green-700 text-white"
                                : "text-green-700 border-green-300 hover:bg-green-50"
                            }`}
                            onClick={() => toggleSerialResult(serial, "confirmed")}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Present
                          </Button>
                          <Button
                            size="sm"
                            variant={result === "not_found" ? "default" : "outline"}
                            className={`h-9 text-xs ${
                              result === "not_found"
                                ? "bg-red-600 hover:bg-red-700 text-white"
                                : "text-red-700 border-red-300 hover:bg-red-50"
                            }`}
                            onClick={() => toggleSerialResult(serial, "not_found")}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                            Not Found
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Submit button */}
            <Button
              className={`w-full h-14 text-lg font-bold ${
                allMarked
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : ""
              }`}
              disabled={!allMarked || serialVerificationSubmitting}
              onClick={handleSerialVerificationSubmit}
            >
              {serialVerificationSubmitting
                ? "Submitting..."
                : allMarked
                  ? "Submit Verification"
                  : `${unmarkedCount} serial${unmarkedCount !== 1 ? "s" : ""} remaining`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Bin Selection ----------
  if (pageState === "bin-selection") {
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

    return (
      <div className="flex flex-col h-[calc(100vh-7.5rem)]">
        {/* Header: team info + progress + search */}
        <div className="p-4 space-y-3 border-b">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{user?.name}</span>
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
              onClick={() => {
                setResumeBin(null);
                selectBin(resumeBin.binName);
              }}
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
                onClick={() => updateSettings({ binViewMode: settings.binViewMode === "grid" ? "list" : "grid" })}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title={settings.binViewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
              >
                {settings.binViewMode === "grid" ? <LayoutList className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
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
                            onClick={() => {
                              setActiveSerialTask(task);
                              setSerialVerificationResults({});
                              setPageState("serial-verification");
                            }}
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

  // ---------- Complete ----------
  if (pageState === "complete") {
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
          <Button variant="outline" onClick={goBackToBinSelection}>
            Choose Another Bin
          </Button>
          <Button
            variant="outline"
            onClick={() => setPageState("reviewing")}
          >
            Review Items
          </Button>
          <Button onClick={goBackToBinSelection}>
            Back to Bins
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Recounting (uses same ActiveItemCard as initial count) ----------
  if (pageState === "recounting" && recountItem) {
    const binLabel = selectedBin === "all" ? "All Bins" : selectedBin || "Items";

    return (
      <div className="flex flex-col h-[calc(100vh-7.5rem)]">
        {/* Sticky header */}
        <div className="sticky top-14 z-40 bg-white border-b px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelRecount}
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
              onSubmit={submitRecount}
              onSkip={cancelRecount}
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

  // ---------- Reviewing ----------
  if (pageState === "reviewing") {
    const binLabel =
      selectedBin === "all" ? "All Bins" : selectedBin || "Items";
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
              onClick={goBackToBinSelection}
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
                onClick={() => {
                  setCurrentIndex(0);
                  setPageState("counting");
                }}
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
                        onRecount={(id) => {
                          const target = items.find((i) => i.id === id);
                          if (target) startRecount(target);
                        }}
                      />
                    );
                  }

                  const item = row.item!;
                  return (
                    <CountedItemRow
                      key={item.id}
                      item={item}
                      onRecount={(id) => {
                        const target = items.find((i) => i.id === id);
                        if (target) startRecount(target);
                      }}
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

  // ---------- Counting ----------
  if (!currentEntry) {
    // Shouldn't happen, but fallback
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">No items to count</div>
      </div>
    );
  }

  const binLabel =
    selectedBin === "all" ? "All Bins" : selectedBin || "Items";

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Sticky header */}
      <div className="sticky top-14 z-40 bg-white border-b px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBackToBinSelection}
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
              onSubmitAll={submitSerializedGroup}
              onSkip={skipItem}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={handleFlashComplete}
              comment={comment}
              onCommentChange={setComment}
            />
          ) : (
            <ActiveItemCard
              item={currentEntry.item}
              qtyValue={qtyValue}
              onQtyChange={setQtyValue}
              onSubmit={submitCount}
              onSkip={skipItem}
              comment={comment}
              onCommentChange={setComment}
              inputRef={inputRef}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={handleFlashComplete}
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
