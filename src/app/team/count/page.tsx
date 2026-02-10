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
import { ArrowLeft, CheckCircle2, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

type PageState = "loading" | "bin-selection" | "counting" | "complete" | "reviewing";

export default function CountingPage() {
  const router = useRouter();

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
  const [recountItem, setRecountItem] = useState<CountItem | null>(null);
  const [recountQty, setRecountQty] = useState("");
  const [recountComment, setRecountComment] = useState("");
  const recountInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Bin tabs
  type BinTab = "not-started" | "in-progress" | "completed";
  const [binTab, setBinTab] = useState<BinTab>("not-started");
  const [completedFilter, setCompletedFilter] = useState<"all" | "variances" | "matched">("all");

  // Counting
  const [currentIndex, setCurrentIndex] = useState(0);
  const [qtyValue, setQtyValue] = useState("");
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------- Load items ----------
  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/team/items");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setStats(data.stats || { total: 0, counted: 0, progressPercent: 0 });
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

  // ---------- Derived state ----------
  const binStats = useMemo(() => {
    const map = new Map<
      string,
      { total: number; pending: number; counted: number; matches: number; variances: number }
    >();
    for (const item of items) {
      const bin = item.binNumber || "No Bin";
      const entry = map.get(bin) || { total: 0, pending: 0, counted: 0, matches: 0, variances: 0 };
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
      }
      map.set(bin, entry);
    }
    // Sort: incomplete first (alpha), then complete sorted by variances desc then alpha
    const entries = Array.from(map.entries());
    entries.sort(([a, aStats], [b, bStats]) => {
      const aComplete = aStats.pending === 0 ? 1 : 0;
      const bComplete = bStats.pending === 0 ? 1 : 0;
      if (aComplete !== bComplete) return aComplete - bComplete;
      // Within completed: bins with variances first (most variances at top)
      if (aComplete === 1 && bComplete === 1) {
        if (aStats.variances !== bStats.variances) return bStats.variances - aStats.variances;
      }
      return a.localeCompare(b);
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
    return items.filter(
      (i) =>
        i.itemCode.toLowerCase().includes(q) ||
        (i.description && i.description.toLowerCase().includes(q))
    );
  }, [items, search]);

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

  // Auto-select first tab that has bins
  useEffect(() => {
    if (pageState !== "bin-selection") return;
    if (inProgressBins.length > 0) {
      setBinTab("in-progress");
    } else if (notStartedBins.length > 0) {
      setBinTab("not-started");
    } else if (completedBins.length > 0) {
      setBinTab("completed");
    }
  }, [pageState, notStartedBins.length, inProgressBins.length, completedBins.length]);

  // ---------- Review items (all items in selected bin) ----------
  const reviewItems = useMemo(() => {
    if (!selectedBin) return [];
    if (selectedBin === "all") return items;
    return items.filter((i) =>
      selectedBin === "No Bin" ? !i.binNumber : i.binNumber === selectedBin
    );
  }, [items, selectedBin]);

  // ---------- Index clamping + completion detection ----------
  useEffect(() => {
    if (pageState !== "counting") return;
    if (pendingItems.length === 0) {
      // All items in this bin are counted — return to bin list
      setSelectedBin(null);
      setPageState("bin-selection");
      setCurrentIndex(0);
      toast.success(
        `${selectedBin === "all" ? "All bins" : selectedBin} complete`
      );
      return;
    }
    if (currentIndex >= pendingItems.length) {
      setCurrentIndex(0);
    }
  }, [pendingItems.length, currentIndex, pageState, selectedBin]);

  // ---------- Auto-focus ----------
  const currentItemId = currentItem?.id;
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
          if (qtyValue) {
            setQtyValue("");
          } else {
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
  }, [pageState, qtyValue, search, recountItem]);

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
      setQtyValue("");
      setComment("");
      setShowComment(false);
      setIsSubmitting(false);
    });
  }, [currentItem, qtyValue, comment, isSubmitting, handleCount]);

  const skipItem = useCallback(() => {
    if (pendingItems.length === 0) return;
    setCurrentIndex((i) => (i + 1) % pendingItems.length);
    setQtyValue("");
    setComment("");
    setShowComment(false);
  }, [pendingItems.length]);

  const selectBin = useCallback(
    (bin: string) => {
      setSelectedBin(bin);
      setCurrentIndex(0);
      setQtyValue("");
      setComment("");
      setShowComment(false);
      setSearch("");
      setRecountItem(null);
      setRecountQty("");
      setRecountComment("");

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
    setShowComment(false);
    setCurrentIndex(0);
    setRecountItem(null);
    setRecountQty("");
    setRecountComment("");
  }

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

  // ---------- Loading ----------
  if (pageState === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading items...</div>
      </div>
    );
  }

  // ---------- Bin Selection ----------
  if (pageState === "bin-selection") {
    if (items.length === 0) {
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
          <h1 className="text-lg font-semibold">Select a Bin</h1>
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
              placeholder="Search by part code or description..."
              className="pl-9"
            />
          </div>
        </div>

        {/* Tabs (hidden during search) */}
        {!search.trim() && (
          <div className="border-b bg-muted/30">
            <div className="flex">
              {([
                { key: "not-started" as BinTab, label: "Not Started", count: notStartedBins.length },
                { key: "in-progress" as BinTab, label: "In Progress", count: inProgressBins.length },
                { key: "completed" as BinTab, label: "Completed", count: completedBins.length },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setBinTab(tab.key)}
                  className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors relative ${
                    binTab === tab.key
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/70"
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    binTab === tab.key
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {tab.count}
                  </span>
                  {binTab === tab.key && (
                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
                  )}
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
              {/* Not Started tab */}
              {binTab === "not-started" && (
                <div className="space-y-3">
                  {notStartedBins.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-12">
                      All bins have been started
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {notStartedBins.map(([bin, bStats]) => (
                        <Card
                          key={bin}
                          className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30"
                          onClick={() => selectBin(bin)}
                        >
                          <CardContent className="p-4 space-y-2">
                            <div className="font-mono font-bold text-sm">
                              {bin}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {bStats.total} item{bStats.total !== 1 ? "s" : ""}
                              </span>
                              <Badge variant="secondary" className="text-[10px]">
                                Not started
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* In Progress tab */}
              {binTab === "in-progress" && (
                <div className="space-y-3">
                  {inProgressBins.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-12">
                      No bins in progress
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {inProgressBins.map(([bin, bStats]) => {
                        const percent =
                          bStats.total > 0
                            ? Math.round((bStats.counted / bStats.total) * 100)
                            : 0;
                        return (
                          <Card
                            key={bin}
                            className="cursor-pointer hover:shadow-md transition-all border-blue-200 hover:border-blue-300"
                            onClick={() => selectBin(bin)}
                          >
                            <CardContent className="p-4 space-y-2">
                              <div className="font-mono font-bold text-sm">
                                {bin}
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">
                                  {bStats.total} item{bStats.total !== 1 ? "s" : ""}
                                </span>
                                <span className="font-semibold text-blue-600">
                                  {percent}%
                                </span>
                              </div>
                              <Progress value={percent} className="h-1.5" />
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>{bStats.counted} counted</span>
                                <span>{bStats.pending} remaining</span>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
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
                        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {filteredCompletedBins.map(([bin, bStats]) => {
                            const hasVariances = bStats.variances > 0;
                            return (
                              <Card
                                key={bin}
                                className={`cursor-pointer hover:shadow-md transition-all ${
                                  hasVariances
                                    ? "border-amber-200 hover:border-amber-300"
                                    : "border-green-200 hover:border-green-300"
                                }`}
                                onClick={() => selectBin(bin)}
                              >
                                <CardContent className="p-4 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="font-mono font-bold text-sm">
                                      {bin}
                                    </div>
                                    {hasVariances ? (
                                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                                    ) : (
                                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {bStats.total} item{bStats.total !== 1 ? "s" : ""}
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {hasVariances ? (
                                      <>
                                        <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                                          {bStats.variances} variance{bStats.variances !== 1 ? "s" : ""}
                                        </span>
                                        <span className="text-xs text-green-600">
                                          {bStats.matches} matched
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">
                                        All matched
                                      </span>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
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
            showComment={showComment}
            onToggleComment={() => setShowComment((v) => !v)}
            inputRef={inputRef}
            isSubmitting={isSubmitting}
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
