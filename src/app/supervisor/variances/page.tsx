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
import { Search } from "lucide-react";
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
}

export default function VariancesPage() {
  const [activeVariances, setActiveVariances] = useState<VarianceItem[]>([]);
  const [resolvedVariances, setResolvedVariances] = useState<VarianceItem[]>([]);
  const [activeTotalValue, setActiveTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("active");

  // Edit dialog state
  const [editingItem, setEditingItem] = useState<VarianceItem | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

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

  const filterItems = (items: VarianceItem[]) =>
    search
      ? items.filter(
          (v) =>
            v.itemCode.toLowerCase().includes(search.toLowerCase()) ||
            v.description?.toLowerCase().includes(search.toLowerCase()) ||
            v.binNumber?.toLowerCase().includes(search.toLowerCase()) ||
            v.teamName.toLowerCase().includes(search.toLowerCase())
        )
      : items;

  const filteredActive = filterItems(activeVariances);
  const filteredResolved = filterItems(resolvedVariances);

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Variances</h1>
        <Badge variant="destructive" className="text-sm">
          R
          {activeTotalValue.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}{" "}
          total
        </Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search variances..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
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
          <VarianceTable
            items={filteredActive}
            emptyMessage={
              search ? "No matching variances" : "No variances recorded"
            }
            showEditButton
            onEdit={openEditDialog}
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
    </div>
  );
}

// Shared table component for both tabs
function VarianceTable({
  items,
  emptyMessage,
  showEditButton,
  onEdit,
}: {
  items: VarianceItem[];
  emptyMessage: string;
  showEditButton: boolean;
  onEdit?: (item: VarianceItem) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
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
                {showEditButton && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={showEditButton ? 9 : 8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((v) => (
                  <TableRow key={v.countId}>
                    <TableCell className="font-mono text-sm">
                      {v.itemCode}
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
                          Resolved
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
                    {showEditButton && (
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onEdit?.(v)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
