"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CountItem,
  buildCountingQueue,
  groupReviewItems,
} from "@/components/counting/item-card";
import type { SerialGroupResult } from "@/components/counting/serialized-group-card";
import { BinCompleteBanner } from "@/components/counting/bin-complete-banner";
import { groupBinsByAisle, type BinEntry } from "@/lib/bin-utils";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { useSettings } from "@/contexts/settings-context";
import { markNotificationSeen } from "@/hooks/use-notifications";
import { feedbackMatch, feedbackVariance, feedbackBinComplete } from "@/lib/feedback";
import {
  isMatchTrue,
  naturalCompare,
  type BinTab,
  type PageState,
  type SerialVerificationTask,
  type VerificationItem,
  type VerificationQueueEntry,
} from "@/components/count/types";
import { reportUnknownSerials, useCountSubmission, useVerificationSubmission } from "@/components/count/use-count-submission";
import { BinSelectionView } from "@/components/count/bin-selection-view";
import { CountingView, CountCompleteView, RecountView, ReviewView } from "@/components/count/counting-views";
import { SerialVerificationView, VerificationCountingView } from "@/components/count/verification-views";

export default function CountingPage() {
  const { user } = useAuth();
  const { settings, updateSettings } = useSettings();
  const er = settings.easyRead;
  const sessionKey = `stocktake-last-bin-${user?.id ?? "unknown"}`;
  // Tag offline records with the owning session so they never sync under another team/event
  const offlineScope = useMemo(
    () => (user?.type === "team" && user.eventId != null ? { eventId: user.eventId, teamId: user.id } : {}),
    [user]
  );

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
  // Reuse the same clientId when a verification submit is retried (server dedups on it)
  const verificationClientIdsRef = useRef(new Map<number, string>());
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
  const { handleCount } = useCountSubmission({ items, offlineScope, setItems, setStats });

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
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        // Submit all serials silently (no individual toasts)
        const saved = await Promise.all(
          results.map(({ itemId, qty }) =>
            handleCount(itemId, qty, comment || undefined, true)
          )
        );

        // Show consolidated summary toast built from what was actually saved
        const savedResults = results.filter((_, i) => saved[i]);
        const skipped = results.length - savedResults.length;
        const found = savedResults.filter((r) => r.qty > 0).length;
        const notFound = savedResults.filter((r) => r.qty === 0).length;
        if (savedResults.length === 0) {
          toast.error("No serials were saved (reviewed, pending verification, or rejected)");
        } else if (notFound > 0) {
          toast.warning(`${found} found, ${notFound} not found (-${notFound} variance)`);
        } else {
          toast.success(`All ${found} serials matched`);
        }
        if (skipped > 0 && savedResults.length > 0) {
          toast.error(`${skipped} serial(s) not saved (reviewed, pending verification, or rejected)`);
        }
        // Send unknown serials as a single discrepancy record to supervisor
        if (unknownSerials && unknownSerials.length > 0 && currentEntry?.type === "serialized-group") {
          await reportUnknownSerials({
            itemCode: currentEntry.itemCode,
            description: currentEntry.description || null,
            binNumber: selectedBin === "No Bin" ? null : selectedBin,
            binInternalId: currentEntry.items[0]?.binInternalId || null,
            unknownSerials,
          });
        }

        setShowFlash(true);
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [handleCount, comment, currentEntry, selectedBin]
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
    [items, sessionKey]
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

  const { submitVerificationCount, submitSerializedVerificationGroup } = useVerificationSubmission({
    offlineScope,
    isSubmittingRef,
    verificationClientIdsRef,
    setIsSubmitting,
    currentVerificationItem,
    verificationQtyValue,
    verificationComment,
    verificationItems,
    scopedVerificationItems,
    verificationQueue,
    verificationIndex,
    selectedVerificationBin,
    autoNextBin: settings.autoNextBin,
    startVerificationCounting,
    setVerificationItems,
    setVerificationIndex,
    setShowFlash,
    setSelectedVerificationBin,
    setPageState,
    setBinTab,
  });

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

  const getNextBin = useCallback((currentBin: string | null) => {
    const uncountedBins = binStats
      .filter(([, s]) => s.pending > 0)
      .map(([bin]) => bin)
      .sort(naturalCompare);
    if (!currentBin || uncountedBins.length === 0) return null;
    const currentIdx = uncountedBins.indexOf(currentBin);
    // If current bin is in the list, take the next one; otherwise take the first
    if (currentIdx >= 0 && currentIdx < uncountedBins.length - 1) {
      return uncountedBins[currentIdx + 1];
    }
    // Current bin may no longer be in uncounted list (just completed) — find first bin after it in sort order
    const nextAfter = uncountedBins.find((b) => naturalCompare(b, currentBin) > 0);
    return nextAfter ?? null;
  }, [binStats]);

  const handleBinCompleteFinish = useCallback(() => {
    setShowFlash(false);
    setShowBinComplete(false);
    feedbackBinComplete(settings.hapticFeedback);
    try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }

    if (settings.autoNextBin) {
      const nextBin = getNextBin(selectedBin);
      if (nextBin) {
        selectBin(nextBin);
        return;
      }
    }

    setSelectedBin(null);
    setPageState("bin-selection");
    setCurrentIndex(0);
  }, [settings.hapticFeedback, settings.autoNextBin, getNextBin, selectedBin, selectBin, sessionKey]);

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
    return (
      <VerificationCountingView
        verificationQueue={verificationQueue}
        verificationIndex={verificationIndex}
        setVerificationIndex={setVerificationIndex}
        selectedVerificationBin={selectedVerificationBin}
        remainingCount={scopedVerificationItems.length}
        onBack={() => {
          setSelectedVerificationBin(null);
          goBackToBinSelection();
        }}
        verificationQtyValue={verificationQtyValue}
        setVerificationQtyValue={setVerificationQtyValue}
        verificationComment={verificationComment}
        setVerificationComment={setVerificationComment}
        onSubmitSingle={submitVerificationCount}
        onSubmitSerializedGroup={submitSerializedVerificationGroup}
        inputRef={inputRef}
        isSubmitting={isSubmitting}
        showFlash={showFlash}
        onFlashComplete={handleFlashComplete}
      />
    );
  }

  // ---------- Serial Verification ----------
  if (pageState === "serial-verification" && activeSerialTask) {
    return (
      <SerialVerificationView
        activeSerialTask={activeSerialTask}
        serialVerificationResults={serialVerificationResults}
        setSerialVerificationResults={setSerialVerificationResults}
        serialVerificationSubmitting={serialVerificationSubmitting}
        setSerialVerificationSubmitting={setSerialVerificationSubmitting}
        onBack={() => {
          setActiveSerialTask(null);
          setSerialVerificationResults({});
          setPageState("bin-selection");
        }}
        onSubmitted={() => {
          setSerialVerificationTasks((prev) =>
            prev.filter((t) => t.id !== activeSerialTask.id)
          );
          setActiveSerialTask(null);
          setSerialVerificationResults({});
          setPageState("bin-selection");
          if (serialVerificationTasks.length > 1 || verificationItems.length > 0) {
            setBinTab("verification");
          }
        }}
      />
    );
  }

  // ---------- Bin Selection ----------
  if (pageState === "bin-selection") {
    return (
      <BinSelectionView
        er={er}
        binViewMode={settings.binViewMode}
        onToggleBinViewMode={() => updateSettings({ binViewMode: settings.binViewMode === "grid" ? "list" : "grid" })}
        userName={user?.name}
        members={members}
        stats={stats}
        items={items}
        verificationItems={verificationItems}
        serialVerificationTasks={serialVerificationTasks}
        search={search}
        setSearch={setSearch}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        searchCollapsed={searchCollapsed}
        setSearchCollapsed={setSearchCollapsed}
        searchInputRef={searchInputRef}
        searchResults={searchResults}
        resumeBin={resumeBin}
        onResume={(binName) => {
          setResumeBin(null);
          selectBin(binName);
        }}
        binTab={binTab}
        setBinTab={setBinTab}
        binStats={binStats}
        notStartedBins={notStartedBins}
        inProgressBins={inProgressBins}
        completedBins={completedBins}
        filteredCompletedBins={filteredCompletedBins}
        groupedNotStarted={groupedNotStarted}
        groupedInProgress={groupedInProgress}
        groupedCompleted={groupedCompleted}
        completedFilter={completedFilter}
        setCompletedFilter={setCompletedFilter}
        serializedOnly={serializedOnly}
        setSerializedOnly={setSerializedOnly}
        multiItemOnly={multiItemOnly}
        setMultiItemOnly={setMultiItemOnly}
        collapsedAisles={collapsedAisles}
        toggleAisle={toggleAisle}
        expandAllAisles={expandAllAisles}
        collapseAllAisles={collapseAllAisles}
        selectBin={selectBin}
        verificationBinStats={verificationBinStats}
        startVerificationCounting={startVerificationCounting}
        onOpenSerialTask={(task) => {
          setActiveSerialTask(task);
          setSerialVerificationResults({});
          setPageState("serial-verification");
        }}
      />
    );
  }

  // ---------- Complete ----------
  if (pageState === "complete") {
    return (
      <CountCompleteView
        selectedBin={selectedBin}
        onBack={goBackToBinSelection}
        onReview={() => setPageState("reviewing")}
      />
    );
  }

  // ---------- Recounting (uses same ActiveItemCard as initial count) ----------
  if (pageState === "recounting" && recountItem) {
    return (
      <RecountView
        selectedBin={selectedBin}
        recountItem={recountItem}
        qtyValue={qtyValue}
        setQtyValue={setQtyValue}
        comment={comment}
        setComment={setComment}
        onSubmit={submitRecount}
        onCancel={cancelRecount}
        inputRef={inputRef}
        isSubmitting={isSubmitting}
      />
    );
  }

  // ---------- Reviewing ----------
  if (pageState === "reviewing") {
    return (
      <ReviewView
        selectedBin={selectedBin}
        scopedStats={scopedStats}
        reviewItems={reviewItems}
        groupedReviewItems={groupedReviewItems}
        onBack={goBackToBinSelection}
        onContinueCounting={() => {
          setCurrentIndex(0);
          setPageState("counting");
        }}
        onRecount={(id) => {
          const target = items.find((i) => i.id === id);
          if (target) startRecount(target);
        }}
      />
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

  return (
    <CountingView
      selectedBin={selectedBin}
      scopedStats={scopedStats}
      currentEntry={currentEntry}
      countingQueue={countingQueue}
      upcomingEntries={upcomingEntries}
      onBack={goBackToBinSelection}
      qtyValue={qtyValue}
      setQtyValue={setQtyValue}
      comment={comment}
      setComment={setComment}
      onSubmitCount={submitCount}
      onSubmitSerializedGroup={submitSerializedGroup}
      onSkip={skipItem}
      inputRef={inputRef}
      isSubmitting={isSubmitting}
      showFlash={showFlash}
      onFlashComplete={handleFlashComplete}
      queueSearch={queueSearch}
      setQueueSearch={setQueueSearch}
      jumpToEntry={jumpToEntry}
    />
  );
}
