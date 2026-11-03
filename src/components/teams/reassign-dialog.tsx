"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ArrowRightLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AssignmentState } from "./use-assignment";
import { binRefLabel, type BinRef } from "./assign-types";

export interface ReassignRequest {
  fromTeamId: number;
  bins: BinRef[];
  hasCountedBins: boolean;
}

/** Supervisor-only: move bins from one team to another (PATCH /api/admin/assign). */
export function useReassign(assign: AssignmentState) {
  const { eventId, loadData, clearTeamBinSelection, brandFilter } = assign;
  const [reassignDialog, setReassignDialog] = useState<ReassignRequest | null>(null);
  const [reassignToTeam, setReassignToTeam] = useState<string>("");
  const [reassigning, setReassigning] = useState(false);

  const openReassign = (request: ReassignRequest) => {
    setReassignDialog(request);
    setReassignToTeam("");
  };

  const closeReassign = () => {
    setReassignDialog(null);
    setReassignToTeam("");
  };

  const handleReassign = async () => {
    if (!reassignDialog || !reassignToTeam) return;
    setReassigning(true);
    try {
      const res = await fetch("/api/admin/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eventId),
          fromTeamId: reassignDialog.fromTeamId,
          toTeamId: Number(reassignToTeam),
          bins: reassignDialog.bins,
          // With a brand filter active only that brand's items move (what the list shows)
          ...(brandFilter ? { brand: brandFilter } : {}),
          ...(reassignDialog.hasCountedBins ? { clearCounts: true } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Re-assigned ${data.movedCount} items (${reassignDialog.bins.length} bins)`);
        setReassignDialog(null);
        setReassignToTeam("");
        clearTeamBinSelection(reassignDialog.fromTeamId);
        loadData();
      } else {
        const data = await res.json();
        toast.error(data.error || "Re-assign failed");
      }
    } catch {
      toast.error("Re-assign failed");
    } finally {
      setReassigning(false);
    }
  };

  return {
    reassignDialog,
    reassignToTeam,
    setReassignToTeam,
    reassigning,
    openReassign,
    closeReassign,
    handleReassign,
  };
}

export type ReassignState = ReturnType<typeof useReassign>;

export function ReassignDialog({ assign, reassign }: { assign: AssignmentState; reassign: ReassignState }) {
  const { teamDetails } = assign;
  const { reassignDialog, reassignToTeam, setReassignToTeam, reassigning, closeReassign, handleReassign } = reassign;
  if (!reassignDialog) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-sm mx-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Re-assign {reassignDialog.bins.length} bin{reassignDialog.bins.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            From: <span className="font-medium text-foreground">
              {teamDetails.find(t => t.id === reassignDialog.fromTeamId)?.name}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Bins: {reassignDialog.bins.map(binRefLabel).join(", ")}
          </div>
          {reassignDialog.hasCountedBins && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold">Warning: Counted data will be cleared</p>
                <p className="mt-0.5">One or more of these bins have already been counted. Re-assigning will permanently delete all count data for these bins.</p>
              </div>
            </div>
          )}
          <Select value={reassignToTeam} onValueChange={setReassignToTeam}>
            <SelectTrigger>
              <SelectValue placeholder="Move to team..." />
            </SelectTrigger>
            <SelectContent>
              {teamDetails
                .filter(t => t.id !== reassignDialog.fromTeamId)
                .map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name} ({t.itemCount} items)
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={closeReassign}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!reassignToTeam || reassigning}
              onClick={handleReassign}
              className="gap-1"
            >
              {reassigning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-3 w-3" />
              )}
              {reassigning ? "Moving..." : "Confirm"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
