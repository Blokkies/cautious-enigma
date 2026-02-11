"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

interface VarianceItem {
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
  teamName: string;
  comment: string | null;
  checkStatus: string;
  countedAt: string;
  // Verification fields
  verificationId?: number;
  verificationStatus?: string;
  verificationTeamName?: string;
  verificationTeamId?: number;
  verificationQty?: number | null;
  verificationVariance?: number | null;
  verificationCountedAt?: string | null;
  // Serial discrepancy fields
  isUnknownSerial?: boolean;
  serialNumber?: string;
}

interface Team {
  id: number;
  name: string;
  member1: string | null;
  member2: string | null;
}

export default function VariancesPage() {
  const [activeVariances, setActiveVariances] = useState<VarianceItem[]>([]);
  const [resolvedVariances, setResolvedVariances] = useState<VarianceItem[]>([]);
  const [activeTotalValue, setActiveTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"contains" | "starts" | "exact" | "bin">("contains");
  const [activeTab, setActiveTab] = useState("active");

  // Edit dialog state
  const [editingItem, setEditingItem] = useState<VarianceItem | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Verification selection state
  const [selectedCountIds, setSelectedCountIds] = useState<Set<number>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [thresholdValue, setThresholdValue] = useState("");

  const loadVariances = useCallback(async () => {
    try {
      const [activeRes, resolvedRes] = await Promise.all([
        fetch("/api/supervisor/variances"),
        fetch("/api/supervisor/variances?tab=resolved"),
      ]);

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveVariances(data.variances || []);
        setActiveTotalValue(data.totalVarianceValue || 0);
      }

      if (resolvedRes.ok) {
        const data = await resolvedRes.json();
        setResolvedVariances(data.variances || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVariances();
    const interval = setInterval(loadVariances, 15000);
    return () => clearInterval(interval);
  }, [loadVariances]);

  // Focus edit input when dialog opens
  useEffect(() => {
    if (editingItem && editInputRef.current) {
      setTimeout(() => editInputRef.current?.select(), 50);
    }
  }, [editingItem]);

  const openEditDialog = (v: VarianceItem) => {
    setEditingItem(v);
    setEditQty(String(v.countedQty));
    setEditReason("");
  };

  const closeEditDialog = () => {
    setEditingItem(null);
    setEditQty("");
    setEditReason("");
  };

  const saveEdit = async () => {
    if (!editingItem) return;

    const newQty = parseFloat(editQty);
    if (isNaN(newQty)) {
      toast.error("Please enter a valid number");
      return;
    }

    if (newQty === editingItem.countedQty) {
      closeEditDialog();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countId: editingItem.countId,
          newQty,
          reason: editReason || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update count");
        return;
      }

      const { count } = await res.json();

      if (count.isMatch) {
        // Variance resolved — remove from active, add to resolved
        setActiveVariances((prev) =>
          prev.filter((v) => v.countId !== editingItem.countId)
        );
        setActiveTotalValue(
          (prev) => prev - Math.abs(editingItem.varianceValue)
        );
        setResolvedVariances((prev) => [
          {
            ...editingItem,
            countedQty: count.countedQty,
            variance: count.variance,
            varianceValue: count.varianceValue,
            checkStatus: "accepted",
          },
          ...prev,
        ]);
        toast.success(`${editingItem.itemCode} — variance resolved`);
      } else {
        // Update row in place
        setActiveVariances((prev) =>
          prev.map((v) =>
            v.countId === editingItem.countId
              ? {
                  ...v,
                  countedQty: count.countedQty,
                  variance: count.variance,
                  varianceValue: count.varianceValue,
                  checkStatus: "accepted",
                }
              : v
          )
        );
        setActiveTotalValue(
          (prev) =>
            prev -
            Math.abs(editingItem.varianceValue) +
            Math.abs(count.varianceValue)
        );
        toast.success(
          `${editingItem.itemCode} count updated to ${count.countedQty}`
        );
      }
    } catch {
      toast.error("Failed to update — check your connection");
    } finally {
      setSaving(false);
      closeEditDialog();
    }
  };

  // Selection helpers
  const toggleSelection = (countId: number) => {
    setSelectedCountIds((prev) => {
      const next = new Set(prev);
      if (next.has(countId)) {
        next.delete(countId);
      } else {
        next.add(countId);
      }
      return next;
    });
  };

  const selectableItems = activeVariances.filter(
    (v) => !v.isUnknownSerial && (!v.verificationId || v.verificationStatus === "accepted")
  );

  const toggleSelectAll = () => {
    const filtered = filterItems(selectableItems);
    if (selectedCountIds.size === filtered.length && filtered.length > 0) {
      setSelectedCountIds(new Set());
    } else {
      setSelectedCountIds(new Set(filtered.map((v) => v.countId)));
    }
  };

  const canSelect = (v: VarianceItem) =>
    !v.isUnknownSerial && (!v.verificationId || v.verificationStatus === "accepted");

  const selectAboveThreshold = () => {
    const threshold = parseFloat(thresholdValue);
    if (isNaN(threshold) || threshold < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const matching = filterItems(selectableItems).filter(
      (v) => Math.abs(v.varianceValue) >= threshold
    );
    if (matching.length === 0) {
      toast.info("No variances above that amount");
      return;
    }
    setSelectedCountIds(new Set(matching.map((v) => v.countId)));
    toast.success(`${matching.length} item${matching.length !== 1 ? "s" : ""} selected`);
  };

  // Assign verification
  const openAssignDialog = async () => {
    if (selectedCountIds.size === 0) {
      toast.error("Select at least one variance item");
      return;
    }
    try {
      const res = await fetch("/api/supervisor/teams");
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams || []);
      }
    } catch {
      toast.error("Failed to load teams");
    }
    setSelectedTeamIds(new Set());
    setShowAssignDialog(true);
  };

  const toggleTeamSelection = (teamId: number) => {
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const submitAssignment = async () => {
    if (selectedTeamIds.size === 0) {
      toast.error("Select at least one team");
      return;
    }

    setAssigning(true);
    try {
      const allCountIds = Array.from(selectedCountIds);
      const teamIds = Array.from(selectedTeamIds);

      // Round-robin distribute items across selected teams
      const teamChunks: Map<number, number[]> = new Map();
      for (const tid of teamIds) teamChunks.set(tid, []);
      allCountIds.forEach((countId, i) => {
        const tid = teamIds[i % teamIds.length];
        teamChunks.get(tid)!.push(countId);
      });

      let totalCreated = 0;
      for (const [teamId, countIds] of Array.from(teamChunks.entries())) {
        if (countIds.length === 0) continue;
        const res = await fetch("/api/supervisor/verifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ countIds, assignedTeamId: teamId }),
        });

        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || `Failed to assign to team`);
          continue;
        }

        const data = await res.json();
        totalCreated += data.created;
      }

      const teamNames = teamIds
        .map((tid) => teams.find((t) => t.id === tid)?.name)
        .filter(Boolean);

      toast.success(
        `${totalCreated} verification${totalCreated !== 1 ? "s" : ""} distributed across ${teamNames.join(", ")}`
      );
      setSelectedCountIds(new Set());
      setShowAssignDialog(false);
      loadVariances();
    } catch {
      toast.error("Failed to assign — check your connection");
    } finally {
      setAssigning(false);
    }
  };

  // Accept original/verification
  const handleAccept = async (
    action: "accept_original" | "accept_verification",
    v: VarianceItem
  ) => {
    if (!v.verificationId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          verificationId: v.verificationId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to accept");
        return;
      }

      toast.success(
        action === "accept_original"
          ? "Original count accepted"
          : "Verification count accepted"
      );
      loadVariances();
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSaving(false);
    }
  };

  const filterItems = (items: VarianceItem[]) => {
    if (!search) return items;
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
          return false; // handled separately
        case "contains":
        default:
          return v.includes(q);
      }
    };

    if (searchMode === "bin") {
      return items.filter((v) => {
        const bin = (v.binNumber || "").toLowerCase();
        return bin.startsWith(q) || bin === q;
      });
    }

    return items.filter(
      (v) =>
        matchField(v.itemCode) ||
        matchField(v.description) ||
        matchField(v.binNumber) ||
        matchField(v.teamName)
    );
  };

  const filteredActive = filterItems(activeVariances);
  const filteredResolved = filterItems(resolvedVariances);

  // Summary counts for header badges
  const needReviewCount = activeVariances.filter(
    (v) => v.verificationStatus === "completed"
  ).length;
  const pendingVerificationCount = activeVariances.filter(
    (v) => v.verificationStatus === "pending"
  ).length;
  const unassignedCount = activeVariances.filter(
    (v) => !v.verificationId || v.verificationStatus === "accepted"
  ).length;

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold">Variances</h1>
          {needReviewCount > 0 && (
            <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs">
              {needReviewCount} need review
            </Badge>
          )}
          {pendingVerificationCount > 0 && (
            <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
              {pendingVerificationCount} pending verification
            </Badge>
          )}
          {unassignedCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unassignedCount} unassigned
            </Badge>
          )}
        </div>
        <Badge variant="destructive" className="text-sm">
          R
          {activeTotalValue.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{" "}
          total
        </Badge>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              searchMode === "bin"
                ? "Search by bin..."
                : searchMode === "exact"
                  ? "Exact match..."
                  : searchMode === "starts"
                    ? "Starts with..."
                    : "Search variances..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="active" className="flex-1">
            Active Variances ({activeVariances.length})
          </TabsTrigger>
          <TabsTrigger value="resolved" className="flex-1">
            Resolved ({resolvedVariances.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {/* Selection toolbar */}
          {activeVariances.length > 0 && (
            <div className="bg-muted/30 rounded-lg p-2 mb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="text-xs"
                  >
                    {selectedCountIds.size === filterItems(selectableItems).length &&
                    filterItems(selectableItems).length > 0
                      ? "☑ Deselect All"
                      : "☐ Select All"}
                  </Button>

                  <div className="h-4 w-px bg-border" />

                  {/* Threshold selector */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">R</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={thresholdValue}
                      onChange={(e) => setThresholdValue(e.target.value)}
                      placeholder="0"
                      className="h-7 w-20 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") selectAboveThreshold();
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={selectAboveThreshold}
                      disabled={!thresholdValue}
                    >
                      Select ≥
                    </Button>
                  </div>
                </div>

                {selectedCountIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {selectedCountIds.size} selected
                    </span>
                    <Button
                      size="sm"
                      onClick={openAssignDialog}
                    >
                      <ClipboardCheck className="h-4 w-4 mr-1" />
                      Assign Verification
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <VarianceTable
            items={filteredActive}
            emptyMessage={
              search ? "No matching variances" : "No variances recorded"
            }
            showEditButton
            showCheckbox
            onEdit={openEditDialog}
            selectedCountIds={selectedCountIds}
            onToggleSelect={toggleSelection}
            canSelect={canSelect}
            onAccept={handleAccept}
            isSaving={saving}
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredActive.length} variance
            {filteredActive.length !== 1 ? "s" : ""}
          </div>
        </TabsContent>

        <TabsContent value="resolved">
          <VarianceTable
            items={filteredResolved}
            emptyMessage={
              search
                ? "No matching resolved variances"
                : "No resolved variances yet"
            }
            showEditButton={false}
            showCheckbox={false}
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredResolved.length} resolved
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog
        open={editingItem !== null}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit Count — {editingItem?.itemCode}
            </DialogTitle>
            <DialogDescription>
              Adjust the counted quantity for this item.
            </DialogDescription>
          </DialogHeader>

          {editingItem && (
            <div className="space-y-4">
              {/* Read-only info */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {editingItem.description && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Description: </span>
                    <span>{editingItem.description}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Bin: </span>
                  <span>{editingItem.binNumber || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Team: </span>
                  <span>{editingItem.teamName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">On Hand: </span>
                  <span className="font-semibold">
                    {editingItem.onHand ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Counted: </span>
                  <span className="font-semibold">
                    {editingItem.countedQty}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">
                    Current Variance:{" "}
                  </span>
                  <Badge
                    variant={
                      Math.abs(editingItem.variance) > 10
                        ? "destructive"
                        : "outline"
                    }
                    className={
                      Math.abs(editingItem.variance) <= 10
                        ? "border-amber-400 text-amber-700"
                        : ""
                    }
                  >
                    {editingItem.variance > 0 ? "+" : ""}
                    {editingItem.variance}
                  </Badge>
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-qty">New Counted Qty</Label>
                  <Input
                    id="edit-qty"
                    ref={editInputRef}
                    type="number"
                    inputMode="decimal"
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                    }}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-reason">Reason (optional)</Label>
                  <Input
                    id="edit-reason"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="e.g. Recounted by supervisor"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Verification Dialog */}
      <Dialog
        open={showAssignDialog}
        onOpenChange={(open) => {
          if (!open) setShowAssignDialog(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Distribute Verification Counts</DialogTitle>
            <DialogDescription>
              Select one or more teams. {selectedCountIds.size} item
              {selectedCountIds.size !== 1 ? "s" : ""} will be distributed
              evenly (round-robin) across the selected teams.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Select Teams</Label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {teams.map((t) => {
                  const isChecked = selectedTeamIds.has(t.id);
                  const itemCount = selectedTeamIds.size > 0
                    ? Math.floor(selectedCountIds.size / selectedTeamIds.size) +
                      (Array.from(selectedTeamIds).indexOf(t.id) <
                      selectedCountIds.size % selectedTeamIds.size
                        ? 1
                        : 0)
                    : 0;
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        isChecked
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTeamSelection(t.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{t.name}</div>
                        {(t.member1 || t.member2) && (
                          <div className="text-xs text-muted-foreground">
                            {[t.member1, t.member2].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </div>
                      {isChecked && (
                        <Badge variant="secondary" className="text-xs flex-shrink-0">
                          {itemCount} item{itemCount !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {selectedTeamIds.size > 0 && (
              <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-2">
                {selectedCountIds.size} item{selectedCountIds.size !== 1 ? "s" : ""}{" "}
                distributed across {selectedTeamIds.size} team
                {selectedTeamIds.size !== 1 ? "s" : ""}.
                Teams will NOT see the original counted quantities.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAssignDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={submitAssignment}
              disabled={assigning || selectedTeamIds.size === 0}
            >
              {assigning
                ? "Assigning..."
                : `Assign to ${selectedTeamIds.size} team${selectedTeamIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Shared table component for both tabs
function VarianceTable({
  items,
  emptyMessage,
  showEditButton,
  showCheckbox,
  onEdit,
  selectedCountIds,
  onToggleSelect,
  canSelect,
  onAccept,
  isSaving,
}: {
  items: VarianceItem[];
  emptyMessage: string;
  showEditButton: boolean;
  showCheckbox: boolean;
  onEdit?: (item: VarianceItem) => void;
  selectedCountIds?: Set<number>;
  onToggleSelect?: (countId: number) => void;
  canSelect?: (item: VarianceItem) => boolean;
  onAccept?: (
    action: "accept_original" | "accept_verification",
    item: VarianceItem
  ) => void;
  isSaving?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {showCheckbox && <TableHead className="w-10"></TableHead>}
                <TableHead>Item Code</TableHead>
                <TableHead className="hidden md:table-cell">
                  Description
                </TableHead>
                <TableHead>Bin</TableHead>
                <TableHead className="text-right">On Hand</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right hidden md:table-cell">
                  Value
                </TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Verification</TableHead>
                {showEditButton && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={showEditButton ? 11 : 10}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((v) => {
                  const isSelectable = canSelect ? canSelect(v) : false;
                  const isSelected = selectedCountIds?.has(v.countId) ?? false;
                  const hasVerification = !!v.verificationId;
                  const isVerificationCompleted =
                    v.verificationStatus === "completed";
                  const isVerificationAccepted =
                    v.verificationStatus === "accepted";
                  const isVerificationPending =
                    v.verificationStatus === "pending";

                  const rowBg = isSelected
                    ? "bg-blue-50"
                    : v.isUnknownSerial
                      ? "bg-amber-50/50"
                      : isVerificationCompleted
                        ? "bg-purple-50/50"
                        : isVerificationPending
                          ? "bg-blue-50/50"
                          : "";

                  return (
                    <TableRow
                      key={v.countId}
                      className={rowBg}
                    >
                      {showCheckbox && (
                        <TableCell>
                          {isSelectable && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => onToggleSelect?.(v.countId)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-sm">
                        <div>{v.itemCode}</div>
                        {v.isUnknownSerial && v.serialNumber && (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] mt-0.5 font-mono">
                            S/N: {v.serialNumber}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
                        {v.description}
                      </TableCell>
                      <TableCell className="text-sm">{v.binNumber}</TableCell>
                      <TableCell className="text-right">{v.onHand}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {v.countedQty}
                      </TableCell>
                      <TableCell className="text-right">
                        {showEditButton ? (
                          <Badge
                            variant={
                              Math.abs(v.variance) > 10
                                ? "destructive"
                                : "outline"
                            }
                            className={
                              Math.abs(v.variance) <= 10
                                ? "border-amber-400 text-amber-700"
                                : ""
                            }
                          >
                            {v.variance > 0 ? "+" : ""}
                            {v.variance}
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            {v.variance > 0 ? "+" : ""}
                            {v.variance} Resolved
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell text-sm">
                        R
                        {Math.abs(v.varianceValue).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </TableCell>
                      <TableCell className="text-sm">{v.teamName}</TableCell>
                      <TableCell className="text-sm">
                        {v.isUnknownSerial && (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
                            Unknown Serial
                          </Badge>
                        )}
                        {!v.isUnknownSerial && !hasVerification && (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {!v.isUnknownSerial && isVerificationPending && (
                          <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
                            Pending — {v.verificationTeamName}
                          </Badge>
                        )}
                        {!v.isUnknownSerial && isVerificationCompleted && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs whitespace-nowrap">
                                Verified: {v.verificationQty}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                by {v.verificationTeamName}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Original: {v.countedQty} → Verified: {v.verificationQty}
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs px-2.5"
                                onClick={() =>
                                  onAccept?.("accept_original", v)
                                }
                                disabled={isSaving}
                              >
                                Keep Original
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700 text-white"
                                onClick={() =>
                                  onAccept?.("accept_verification", v)
                                }
                                disabled={isSaving}
                              >
                                Accept Verified
                              </Button>
                            </div>
                          </div>
                        )}
                        {!v.isUnknownSerial && isVerificationAccepted && (
                          <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
                            Verification Resolved
                          </Badge>
                        )}
                      </TableCell>
                      {showEditButton && (
                        <TableCell>
                          {!v.isUnknownSerial && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => onEdit?.(v)}
                            >
                              Edit
                            </Button>
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
  );
}
