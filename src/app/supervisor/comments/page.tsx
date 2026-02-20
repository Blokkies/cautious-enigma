"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, MessageSquare, CheckCircle2, AlertTriangle, Clock, Check } from "lucide-react";

interface CommentItem {
  countId: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  binNumber: string | null;
  onHand: number | null;
  avgCost: number | null;
  countedQty: number;
  variance: number;
  varianceValue: number;
  isMatch: boolean;
  checkStatus: string;
  comment: string;
  commentStatus: string | null;
  countedAt: string;
  teamId: number;
  teamName: string;
  serialNumber: string | null;
  isSerialized: boolean | number | null;
  stockStatus: string | null;
}

type StatusFilter = "all" | "open" | "has-variance" | "reviewed";

export default function SupervisorCommentsPage() {
  const { user } = useAuth();
  const isExecutive = user?.type === "executive";
  const isAuditor = user?.type === "auditor";
  const canReview = !isAuditor && !isExecutive;

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"contains" | "starts" | "bin" | "team">("contains");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reviewing, setReviewing] = useState<Set<number>>(new Set());

  // Executive event picker
  const [execEvents, setExecEvents] = useState<{ id: number; name: string; status: string }[]>([]);
  const [execEventId, setExecEventId] = useState<number>(0);
  const [execEventsLoaded, setExecEventsLoaded] = useState(!isExecutive);

  useEffect(() => {
    if (!isExecutive) return;
    (async () => {
      try {
        const res = await fetch("/api/executive/dashboard");
        if (res.ok) {
          const data = await res.json();
          const evts = (data.events || []).map((e: { id: number; name: string; status: string }) => ({
            id: e.id, name: e.name, status: e.status,
          }));
          setExecEvents(evts);
          if (evts.length > 0 && execEventId === 0) {
            const active = evts.find((e: { status: string }) => e.status === "active");
            setExecEventId(active?.id ?? evts[0].id);
          }
        }
      } catch {}
      setExecEventsLoaded(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecutive]);

  const loadComments = useCallback(async () => {
    if (isExecutive && (!execEventsLoaded || !execEventId)) return;
    const eidParam = isExecutive ? `eventId=${execEventId}` : "";
    try {
      const res = await fetch(`/api/supervisor/comments?${eidParam}`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, [isExecutive, execEventId, execEventsLoaded]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Clear selections when filter or search changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, search, searchMode]);

  const filtered = useMemo(() => {
    let result = comments;

    // Status filter
    if (statusFilter === "open") {
      result = result.filter((c) => c.commentStatus !== "reviewed" && c.isMatch);
    } else if (statusFilter === "has-variance") {
      result = result.filter((c) => c.commentStatus !== "reviewed" && !c.isMatch);
    } else if (statusFilter === "reviewed") {
      result = result.filter((c) => c.commentStatus === "reviewed");
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        if (searchMode === "bin") {
          return (c.binNumber || "").toLowerCase().startsWith(q);
        }
        if (searchMode === "team") {
          return c.teamName.toLowerCase().includes(q);
        }
        const matchField = (val: string | null) => {
          if (!val) return false;
          const v = val.toLowerCase();
          return searchMode === "starts" ? v.startsWith(q) : v.includes(q);
        };
        return (
          matchField(c.itemCode) ||
          matchField(c.description) ||
          matchField(c.binNumber) ||
          matchField(c.comment) ||
          matchField(c.teamName)
        );
      });
    }

    return result;
  }, [comments, search, searchMode, statusFilter]);

  // Stats
  const openCount = comments.filter((c) => c.commentStatus !== "reviewed" && c.isMatch).length;
  const hasVarianceCount = comments.filter((c) => c.commentStatus !== "reviewed" && !c.isMatch).length;
  const reviewedCount = comments.filter((c) => c.commentStatus === "reviewed").length;

  // Unreviewable items in current filtered view (for bulk select)
  const unreviewedInView = useMemo(
    () => filtered.filter((c) => c.commentStatus !== "reviewed"),
    [filtered]
  );

  const handleReviewComment = async (countId: number) => {
    setReviewing((prev) => new Set(prev).add(countId));
    // Optimistic update
    setComments((prev) =>
      prev.map((c) => (c.countId === countId ? { ...c, commentStatus: "reviewed" } : c))
    );
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(countId);
      return next;
    });

    try {
      const res = await fetch("/api/supervisor/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review_comment", countId }),
      });
      if (!res.ok) {
        // Revert on failure
        setComments((prev) =>
          prev.map((c) => (c.countId === countId ? { ...c, commentStatus: null } : c))
        );
      }
    } catch {
      // Revert on failure
      setComments((prev) =>
        prev.map((c) => (c.countId === countId ? { ...c, commentStatus: null } : c))
      );
    } finally {
      setReviewing((prev) => {
        const next = new Set(prev);
        next.delete(countId);
        return next;
      });
    }
  };

  const handleBulkReview = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setReviewing(new Set(ids));
    // Optimistic update
    setComments((prev) =>
      prev.map((c) => (ids.includes(c.countId) ? { ...c, commentStatus: "reviewed" } : c))
    );
    setSelectedIds(new Set());

    try {
      const res = await fetch("/api/supervisor/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_review_comments", countIds: ids }),
      });
      if (!res.ok) {
        // Revert on failure
        setComments((prev) =>
          prev.map((c) => (ids.includes(c.countId) ? { ...c, commentStatus: null } : c))
        );
      }
    } catch {
      // Revert on failure
      setComments((prev) =>
        prev.map((c) => (ids.includes(c.countId) ? { ...c, commentStatus: null } : c))
      );
    } finally {
      setReviewing(new Set());
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === unreviewedInView.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unreviewedInView.map((c) => c.countId)));
    }
  };

  const toggleSelect = (countId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(countId)) {
        next.delete(countId);
      } else {
        next.add(countId);
      }
      return next;
    });
  };

  const getStatusBadge = (c: CommentItem) => {
    if (c.commentStatus === "reviewed") {
      return (
        <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px] gap-0.5">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Reviewed
        </Badge>
      );
    }
    if (c.isMatch) {
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" />
          Open
        </Badge>
      );
    }
    // Has variance — show variance status
    const varianceLabel =
      c.checkStatus === "accepted"
        ? "Accepted"
        : c.checkStatus === "recounted"
          ? "Recounted"
          : "Active";
    return (
      <Badge className="bg-red-100 text-red-800 border-red-300 text-[10px] gap-0.5">
        <AlertTriangle className="h-2.5 w-2.5" />
        Variance — {varianceLabel}
      </Badge>
    );
  };

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString(undefined, {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Executive event picker */}
      {isExecutive && execEvents.length > 1 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Event:</label>
          <select
            value={execEventId}
            onChange={(e) => { setExecEventId(Number(e.target.value)); setLoading(true); }}
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {execEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name} ({ev.status})</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-blue-500" />
          <h1 className="text-2xl font-bold">Team Comments</h1>
          <Badge variant="secondary" className="text-xs">
            {comments.length} total
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge className={`text-xs ${openCount > 0 ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-muted text-muted-foreground"}`}>
            {openCount} open
          </Badge>
          <Badge className={`text-xs ${hasVarianceCount > 0 ? "bg-red-100 text-red-800 border-red-300" : "bg-muted text-muted-foreground"}`}>
            {hasVarianceCount} variance
          </Badge>
          <Badge className={`text-xs ${reviewedCount > 0 ? "bg-green-100 text-green-800 border-green-300" : "bg-muted text-muted-foreground"}`}>
            {reviewedCount} reviewed
          </Badge>
        </div>
      </div>

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              searchMode === "bin" ? "Search by bin..."
                : searchMode === "team" ? "Search by team..."
                  : searchMode === "starts" ? "Starts with..."
                    : "Search comments, items, bins..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Search:</span>
          {([
            { key: "contains" as const, label: "Contains" },
            { key: "starts" as const, label: "Starts with" },
            { key: "bin" as const, label: "Bin" },
            { key: "team" as const, label: "Team" },
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
          <div className="h-4 w-px bg-border mx-1" />
          <span className="text-xs text-muted-foreground mr-1">Status:</span>
          {([
            { key: "all" as const, label: "All" },
            { key: "open" as const, label: "Open" },
            { key: "has-variance" as const, label: "Has Variance" },
            { key: "reviewed" as const, label: "Reviewed" },
          ]).map((m) => (
            <button
              key={m.key}
              onClick={() => setStatusFilter(m.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                statusFilter === m.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action toolbar */}
      {canReview && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2.5 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            onClick={handleBulkReview}
            disabled={reviewing.size > 0}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Review Selected
          </Button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {/* Comments table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canReview && (
                    <TableHead className="w-10">
                      {unreviewedInView.length > 0 && (
                        <Checkbox
                          checked={selectedIds.size === unreviewedInView.length && unreviewedInView.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      )}
                    </TableHead>
                  )}
                  <TableHead>Item Code</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead>Bin</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[200px]">Comment</TableHead>
                  <TableHead className="hidden md:table-cell">Time</TableHead>
                  {canReview && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canReview ? 12 : 10} className="text-center py-8 text-muted-foreground">
                      {search ? "No comments match your search" : "No team comments recorded"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c) => {
                    const isSerialized = c.isSerialized === true || c.isSerialized === 1;
                    const isReviewed = c.commentStatus === "reviewed";
                    const isReviewingThis = reviewing.has(c.countId);

                    return (
                      <TableRow key={c.countId} className={isReviewed ? "opacity-60" : ""}>
                        {canReview && (
                          <TableCell>
                            {!isReviewed && (
                              <Checkbox
                                checked={selectedIds.has(c.countId)}
                                onCheckedChange={() => toggleSelect(c.countId)}
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm">
                          <div>{c.itemCode}</div>
                          {isSerialized && c.serialNumber && (
                            <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-[10px] mt-0.5 font-mono">
                              S/N: {c.serialNumber}
                            </Badge>
                          )}
                          {c.brand && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">{c.brand}</div>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
                          {c.description}
                        </TableCell>
                        <TableCell className="text-sm font-mono">{c.binNumber}</TableCell>
                        <TableCell className="text-right text-sm">{c.onHand}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{c.countedQty}</TableCell>
                        <TableCell className="text-right">
                          {c.variance === 0 ? (
                            <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">0</Badge>
                          ) : (
                            <Badge
                              variant={Math.abs(c.variance) > 10 ? "destructive" : "outline"}
                              className={Math.abs(c.variance) <= 10 ? "border-amber-400 text-amber-700" : ""}
                            >
                              {c.variance > 0 ? "+" : ""}{c.variance}
                            </Badge>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            R{Math.abs(c.varianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{c.teamName}</TableCell>
                        <TableCell>{getStatusBadge(c)}</TableCell>
                        <TableCell className="min-w-[200px] max-w-[320px]">
                          <div className="flex items-start gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                            <span className="text-sm leading-snug">{c.comment}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(c.countedAt)}
                          </div>
                        </TableCell>
                        {canReview && (
                          <TableCell>
                            {!isReviewed && (
                              <button
                                onClick={() => handleReviewComment(c.countId)}
                                disabled={isReviewingThis}
                                className="p-1 rounded hover:bg-green-100 text-muted-foreground hover:text-green-700 transition-colors disabled:opacity-50"
                                title="Mark as reviewed"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground">
        {filtered.length} comment{filtered.length !== 1 ? "s" : ""}
        {filtered.length !== comments.length && ` (of ${comments.length} total)`}
      </div>
    </div>
  );
}
