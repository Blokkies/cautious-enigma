"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  ActiveItemCard,
  QueueItemRow,
  CountedItemRow,
  CountItem,
} from "@/components/counting/item-card";
import { BinCompleteBanner } from "@/components/counting/bin-complete-banner";
import { groupBinsByAisle, type BinEntry } from "@/lib/bin-utils";
import { ArrowLeft, CheckCircle2, Search, AlertTriangle, ChevronDown, ChevronRight, PlayCircle, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/auth-context";

type PageState = "loading" | "bin-selection" | "counting" | "complete" | "reviewing" | "verification-counting";

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

export default function CountingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const sessionKey = `stocktake-last-bin-${user?.id ?? "unknown"}`;

  // Data
  const [items, setItems] = useState<CountItem[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    counted: 0,
    progressPercent: 0,
  });

  // Page flow
  const [pageState, setPageState] = useState<PageState>("loading");
  const [selectedBin, setSelectedBin] = useState<string | null>(null);

  // Search + Review
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"contains" | "starts" | "exact" | "bin">("contains");
  const [recountItem, setRecountItem] = useState<CountItem | null>(null);
  const [recountQty, setRecountQty] = useState("");
  const [recountComment, setRecountComment] = useState("");
  const recountInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bin tabs
  type BinTab = "not-started" | "in-progress" | "completed" | "verification";
  const [binTab, setBinTab] = useState<BinTab>("not-started");
  const [completedFilter, setCompletedFilter] = useState<"all" | "variances" | "matched">("all");

  // Verification
  const [verificationItems, setVerificationItems] = useState<VerificationItem[]>([]);
  const [selectedVerificationBin, setSelectedVerificationBin] = useState<string | null>(null);
  const [verificationIndex, setVerificationIndex] = useState(0);
  const [verificationQtyValue, setVerificationQtyValue] = useState("");
  const [verificationComment, setVerificationComment] = useState("");

  // Aisle collapse state
  const [collapsedAisles, setCollapsedAisles] = useState<Set<string>>(new Set());

  // Counting
  const [currentIndex, setCurrentIndex] = useState(0);
  const [qtyValue, setQtyValue] = useState("");
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showBinComplete, setShowBinComplete] = useState(false);
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
      const { binName, timestamp } = JSON.parse(stored);
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
      { total: number; pending: number; counted: number; matches: number; variances: number; supervisorEdited: number }
    >();
    for (const item of items) {
      const bin = item.binNumber || "No Bin";
      const entry = map.get(bin) || { total: 0, pending: 0, counted: 0, matches: 0, variances: 0, supervisorEdited: 0 };
      entry.total++;
      if (item.countId === null) {
        entry.pending++;
      } else {
        entry.counted++;
        if (item.variance === 0 || item.isMatch === true || item.isMatch === 1) {
          entry.matches++;
        } else {
          entry.variances++;
        }
        if (item.checkStatus === "accepted") {
          entry.supervisorEdited++;
        }
      }
      map.set(bin, entry);
    }
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

  const currentItem = pendingItems[currentIndex] ?? null;

  const upcomingItems = useMemo(
    () => pendingItems.slice(currentIndex + 1),
    [pendingItems, currentIndex]
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
    () => binStats.filter(([, s]) => s.counted === 0),
    [binStats]
  );
  const inProgressBins = useMemo(
    () => binStats.filter(([, s]) => s.counted > 0 && s.pending > 0),
    [binStats]
  );
  const completedBins = useMemo(
    () => binStats.filter(([, s]) => s.pending === 0),
    [binStats]
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

  // Auto-select first tab that has bins (verification highest priority)
  useEffect(() => {
    if (pageState !== "bin-selection") return;
    if (verificationItems.length > 0) {
      setBinTab("verification");
    } else if (inProgressBins.length > 0) {
      setBinTab("in-progress");
    } else if (notStartedBins.length > 0) {
      setBinTab("not-started");
    } else if (completedBins.length > 0) {
      setBinTab("completed");
    }
  }, [pageState, notStartedBins.length, inProgressBins.length, completedBins.length, verificationItems.length]);

  // ---------- Review items (all items in selected bin) ----------
  const reviewItems = useMemo(() => {
    if (!selectedBin) return [];
    if (selectedBin === "all") return items;
    return items.filter((i) =>
      selectedBin === "No Bin" ? !i.binNumber : i.binNumber === selectedBin
    );
  }, [items, selectedBin]);

  // ---------- Auto-fill qty when currentItem changes ----------
  const currentItemId = currentItem?.id;
  useEffect(() => {
    if (pageState !== "counting" || currentItem == null) return;
    setQtyValue(String(currentItem.onHand ?? 0));
  }, [currentItemId, pageState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Index clamping + completion detection ----------
  useEffect(() => {
    if (pageState !== "counting") return;
    if (showFlash) return; // Wait for flash to finish before detecting completion
    if (pendingItems.length === 0) {
      // Show bin complete banner
      setShowBinComplete(true);
      return;
    }
    if (currentIndex >= pendingItems.length) {
      setCurrentIndex(0);
    }
  }, [pendingItems.length, currentIndex, pageState, showFlash]);

  // ---------- Auto-focus + select ----------
  useEffect(() => {
    if (pageState !== "counting" || currentItemId == null) return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentItemId, pageState]);

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
          const onHandStr = String(currentItem?.onHand ?? 0);
          if (qtyValue !== onHandStr && qtyValue !== "") {
            // First Esc: reset to on-hand
            setQtyValue(onHandStr);
            inputRef.current?.select();
          } else {
            // Second Esc (or empty): go back
            goBackToBinSelection();
          }
          return;
        }
        if (pageState === "reviewing") {
          e.preventDefault();
          if (recountItem) {
            setRecountItem(null);
            setRecountQty("");
            setRecountComment("");
          } else {
            goBackToBinSelection();
          }
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pageState, qtyValue, search, recountItem, currentItem]);

  // ---------- Core functions ----------
  const handleCount = useCallback(
    async (itemId: number, qty: number, countComment?: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;

      const clientId = uuidv4();
      const onHand = item.onHand ?? 0;
      const variance = qty - onHand;
      const isMatch = variance === 0;

      // Optimistic update
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
                countedAt: new Date().toISOString(),
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

        if (!isMatch) {
          toast.warning(`Variance: ${variance > 0 ? "+" : ""}${variance}`);
        }
      } catch {
        toast.error("Count saved locally, will sync when online");
      }
    },
    [items]
  );

  const submitCount = useCallback(() => {
    if (!currentItem || isSubmitting) return;
    const qty = parseFloat(qtyValue);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    setIsSubmitting(true);
    handleCount(currentItem.id, qty, comment || undefined).finally(() => {
      setShowFlash(true);
      setIsSubmitting(false);
    });
  }, [currentItem, qtyValue, comment, isSubmitting, handleCount]);

  const handleFlashComplete = useCallback(() => {
    setShowFlash(false);
    setComment("");
  }, []);

  const skipItem = useCallback(() => {
    if (pendingItems.length === 0) return;
    setCurrentIndex((i) => (i + 1) % pendingItems.length);
    setQtyValue("");
    setComment("");
  }, [pendingItems.length]);

  const selectBin = useCallback(
    (bin: string) => {
      setSelectedBin(bin);
      setCurrentIndex(0);
      setQtyValue("");
      setComment("");
      setShowFlash(false);
      setShowBinComplete(false);
      setSearch("");
      setRecountItem(null);
      setRecountQty("");
      setRecountComment("");

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
    setRecountQty("");
    setRecountComment("");
  }

  // ---------- Verification counting ----------
  const currentVerificationItem = scopedVerificationItems[verificationIndex] ?? null;

  const startVerificationCounting = useCallback((bin: string) => {
    setSelectedVerificationBin(bin);
    setVerificationIndex(0);
    const scoped = verificationItems.filter((vi) => (vi.binNumber || "No Bin") === bin);
    if (scoped.length > 0) {
      setVerificationQtyValue(String(scoped[0].onHand ?? 0));
    }
    setVerificationComment("");
    setShowFlash(false);
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
    try {
      const res = await fetch("/api/team/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: currentVerificationItem.itemId,
          countedQty: qty,
          isMatch: qty === (currentVerificationItem.onHand ?? 0),
          comment: verificationComment || undefined,
          verificationId: currentVerificationItem.verificationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to submit verification");
        return;
      }

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

  // Auto-advance verification after flash
  useEffect(() => {
    if (pageState !== "verification-counting") return;
    if (showFlash) return;
    if (scopedVerificationItems.length === 0) {
      toast.success("All verifications in this bin complete!");
      setSelectedVerificationBin(null);
      setPageState("bin-selection");
      setShowFlash(false);
      setVerificationIndex(0);
      // Stay on verification tab if there are more bins, otherwise auto-select will pick the right one
      if (verificationItems.length > 0) {
        setBinTab("verification");
      }
      return;
    }
    if (verificationIndex >= scopedVerificationItems.length) {
      setVerificationIndex(0);
    }
    const vi = scopedVerificationItems[verificationIndex];
    if (vi) {
      setVerificationQtyValue(String(vi.onHand ?? 0));
      setVerificationComment("");
    }
  }, [scopedVerificationItems.length, verificationIndex, pageState, showFlash]);

  // Auto-focus for verification
  useEffect(() => {
    if (pageState !== "verification-counting" || !currentVerificationItem) return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [currentVerificationItem?.verificationId, pageState]);

  const handleBinCompleteFinish = useCallback(() => {
    setShowFlash(false);
    setShowBinComplete(false);
    setSelectedBin(null);
    setPageState("bin-selection");
    setCurrentIndex(0);
    try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }
  }, []);

  // ---------- Recount submit ----------
  const submitRecount = useCallback(async () => {
    if (!recountItem || isSubmitting) return;
    const qty = parseFloat(recountQty);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }
    setIsSubmitting(true);
    await handleCount(recountItem.id, qty, recountComment || undefined);
    setRecountItem(null);
    setRecountQty("");
    setRecountComment("");
    setIsSubmitting(false);
  }, [recountItem, recountQty, recountComment, isSubmitting, handleCount]);

  // Auto-focus recount input
  useEffect(() => {
    if (recountItem && recountInputRef.current) {
      const timer = setTimeout(() => {
        recountInputRef.current?.focus();
        recountInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [recountItem]);

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

  // ---------- Render helpers ----------
  function renderBinButton(bin: string, bStats: { total: number; pending: number; counted: number; matches: number; variances: number; supervisorEdited: number }, variant: "not-started" | "in-progress" | "completed") {
    const isSingleItem = bStats.total === 1;

    if (variant === "in-progress") {
      const percent = bStats.total > 0 ? Math.round((bStats.counted / bStats.total) * 100) : 0;
      return (
        <button
          key={bin}
          className="text-left px-3 py-2.5 rounded-lg border border-blue-200 hover:border-blue-300 hover:shadow-sm transition-all bg-white"
          onClick={() => selectBin(bin)}
        >
          <div className="font-mono font-bold text-sm truncate">{bin}</div>
          <div className="flex items-center justify-between mt-1">
            {!isSingleItem && (
              <span className="text-[10px] text-muted-foreground">{bStats.pending} left</span>
            )}
            <span className="text-[10px] font-semibold text-blue-600 ml-auto">{percent}%</span>
          </div>
          <Progress value={percent} className="h-1 mt-1" />
          {bStats.supervisorEdited > 0 && (
            <span className="text-[10px] font-medium text-indigo-700 mt-1 block">
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
          className={`text-left px-3 py-2.5 rounded-lg border hover:shadow-sm transition-all bg-white ${
            hasVariances ? "border-amber-200 hover:border-amber-300" : "border-green-200 hover:border-green-300"
          }`}
          onClick={() => selectBin(bin)}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-sm truncate">{bin}</span>
            {hasVariances ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
            )}
          </div>
          {!isSingleItem && (
            <div className="text-[10px] text-muted-foreground mt-1">{bStats.total} items</div>
          )}
          {hasVariances && (
            <span className="text-[10px] font-medium text-amber-700 mt-0.5 block">
              {bStats.variances} variance{bStats.variances !== 1 ? "s" : ""}
            </span>
          )}
          {bStats.supervisorEdited > 0 && (
            <span className="text-[10px] font-medium text-indigo-700 mt-0.5 block">
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
        <div className="font-mono font-bold text-sm truncate">{bin}</div>
        {!isSingleItem && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {bStats.total} items
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
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {group.bins.map(([bin, bStats]) => renderBinButton(bin, bStats, variant))}
            </div>
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
    if (!currentVerificationItem) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">No verification items</div>
        </div>
      );
    }

    // Convert to CountItem shape for ActiveItemCard
    const verAsCountItem: CountItem = {
      id: currentVerificationItem.itemId,
      itemCode: currentVerificationItem.itemCode,
      description: currentVerificationItem.description,
      brand: currentVerificationItem.brand,
      binNumber: currentVerificationItem.binNumber,
      onHand: currentVerificationItem.onHand,
      avgCost: currentVerificationItem.avgCost,
      stockStatus: currentVerificationItem.stockStatus,
      serialNumber: currentVerificationItem.serialNumber,
      isSerialized: currentVerificationItem.isSerialized,
      countId: null,
      countedQty: null,
      variance: null,
      isMatch: null,
      comment: null,
      checkStatus: null,
      countedAt: null,
    };

    const upcomingVerification = scopedVerificationItems.filter((_, i) => i !== verificationIndex);

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

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="max-w-lg mx-auto">
            <ActiveItemCard
              item={verAsCountItem}
              qtyValue={verificationQtyValue}
              onQtyChange={setVerificationQtyValue}
              onSubmit={submitVerificationCount}
              onSkip={() => {
                if (scopedVerificationItems.length <= 1) return;
                setVerificationIndex((i) => (i + 1) % scopedVerificationItems.length);
              }}
              comment={verificationComment}
              onCommentChange={setVerificationComment}
              inputRef={inputRef}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={handleFlashComplete}
              isVerification
            />
          </div>

          {/* Remaining verification items in this bin */}
          {upcomingVerification.length > 0 && (
            <div className="max-w-lg mx-auto">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Up Next ({upcomingVerification.length} more)
              </div>
              <Card>
                <ScrollArea className="max-h-[300px]">
                  <CardContent className="p-0">
                    {upcomingVerification.slice(0, 20).map((vi, i) => (
                      <QueueItemRow
                        key={vi.verificationId}
                        item={{
                          id: vi.itemId,
                          itemCode: vi.itemCode,
                          description: vi.description,
                          brand: vi.brand,
                          binNumber: vi.binNumber,
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
                        }}
                        position={i + 1}
                      />
                    ))}
                  </CardContent>
                </ScrollArea>
              </Card>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- Bin Selection ----------
  if (pageState === "bin-selection") {
    if (items.length === 0 && verificationItems.length === 0) {
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
        {/* Header: progress + search */}
        <div className="p-4 space-y-3 border-b">
          <div className="flex items-center gap-3">
            <Progress value={stats.progressPercent} className="h-3 flex-1" />
            <span className="text-sm font-semibold text-primary min-w-[3rem] text-right">
              {stats.progressPercent}%
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            {stats.counted} of {stats.total} items counted
          </div>
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
            <div className="px-4 pt-3 pb-1">
              <h1 className="text-lg font-semibold">Select a Bin</h1>
            </div>
            <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
              {([
                ...(verificationItems.length > 0
                  ? [{ key: "verification" as BinTab, label: "Verification", count: verificationItems.length }]
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
                    renderAisleGroupedBins(groupedNotStarted, "not-started")
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
                    renderAisleGroupedBins(groupedInProgress, "in-progress")
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
                        renderAisleGroupedBins(groupedCompleted, "completed")
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
          <Button onClick={() => router.push("/team")}>
            Back to Dashboard
          </Button>
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
      (i) => i.variance === 0 || i.isMatch === true || i.isMatch === 1
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
                {reviewItems.map((item) => (
                  <div key={item.id}>
                    <CountedItemRow
                      item={item}
                      onRecount={(id) => {
                        const target = items.find((i) => i.id === id);
                        if (target) {
                          setRecountItem(target);
                          setRecountQty(
                            target.countedQty != null
                              ? String(target.countedQty)
                              : ""
                          );
                          setRecountComment("");
                        }
                      }}
                    />
                    {/* Inline recount form */}
                    {recountItem?.id === item.id && (
                      <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-200 space-y-2">
                        <div className="text-sm font-medium">
                          Recount: {item.itemCode}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            ref={recountInputRef}
                            type="number"
                            inputMode="decimal"
                            value={recountQty}
                            onChange={(e) => setRecountQty(e.target.value)}
                            placeholder="New qty"
                            className="h-10 text-base flex-1"
                            disabled={isSubmitting}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                submitRecount();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setRecountItem(null);
                                setRecountQty("");
                                setRecountComment("");
                              }
                            }}
                          />
                          <Button
                            className="h-10"
                            disabled={!recountQty || isSubmitting}
                            onClick={submitRecount}
                          >
                            Save
                          </Button>
                          <Button
                            variant="outline"
                            className="h-10"
                            onClick={() => {
                              setRecountItem(null);
                              setRecountQty("");
                              setRecountComment("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Counting ----------
  if (!currentItem) {
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
      <div className="sticky top-14 z-40 bg-white border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBackToBinSelection}
            className="px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-mono font-semibold text-sm">{binLabel}</span>
          <span className="text-sm text-muted-foreground">
            {scopedStats.pending} remaining
          </span>
          <div className="flex-1">
            <Progress value={scopedStats.percent} className="h-2" />
          </div>
          <span className="text-sm font-semibold min-w-[3rem] text-right">
            {scopedStats.percent}%
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Active item */}
        <div className="max-w-lg mx-auto">
          <ActiveItemCard
            item={currentItem}
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
        </div>

        {/* Queue */}
        {upcomingItems.length > 0 && (
          <div className="max-w-lg mx-auto">
            <div className="text-sm font-medium text-muted-foreground mb-2">
              Up Next ({upcomingItems.length} more)
            </div>
            <Card>
              <ScrollArea className="max-h-[300px]">
                <CardContent className="p-0">
                  {upcomingItems.slice(0, 20).map((item, i) => (
                    <QueueItemRow
                      key={item.id}
                      item={item}
                      position={i + 1}
                    />
                  ))}
                  {upcomingItems.length > 20 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                      ...and {upcomingItems.length - 20} more
                    </div>
                  )}
                </CardContent>
              </ScrollArea>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
