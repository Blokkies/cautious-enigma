"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, MessageSquare, AlertTriangle, Loader2 } from "lucide-react";
import { getStockStatusStyle } from "@/components/counting/item-card";
import { selectedVarianceValue, type VarianceItem } from "./types";
import type { SerialEditing, SerialVerifyAssignment, VarianceEditing, VarianceSelection } from "./use-variance-actions";

/** Edit Dialog — matches team counting interface */
export function EditVarianceDialog({ edit, saving }: { edit: VarianceEditing; saving: boolean }) {
  const {
    editingItem,
    editQty,
    setEditQty,
    editReason,
    setEditReason,
    editShowComment,
    setEditShowComment,
    editInputRef,
    closeEditDialog,
    saveEdit,
  } = edit;

  return (
    <Dialog
      open={editingItem !== null}
      onOpenChange={(open) => {
        if (!open) closeEditDialog();
      }}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        {editingItem && (() => {
          const isSerialized = editingItem.isSerialized === true || editingItem.isSerialized === 1;
          const onHand = editingItem.onHand ?? 0;
          const isMatchValue = editQty === String(onHand);
          const newVariance = editQty ? parseFloat(editQty) - onHand : null;

          return (
            <div className="space-y-4 p-4">
              {/* Bin number — prominent */}
              {editingItem.binNumber && (
                <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bin</span>
                  <span className="font-mono font-bold text-base">{editingItem.binNumber}</span>
                </div>
              )}

              {/* Item Code */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Item Code</div>
                <div className="font-mono font-bold text-xl tracking-tight">
                  {editingItem.itemCode}
                </div>
              </div>

              {/* Description */}
              {editingItem.description && (
                <div className="space-y-0.5">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Description</div>
                  <div className="text-sm leading-snug">
                    {editingItem.description}
                  </div>
                </div>
              )}

              {/* Metadata badges */}
              <div className="flex flex-wrap items-center gap-1.5">
                {editingItem.brand && (
                  <Badge variant="secondary" className="text-xs">
                    {editingItem.brand}
                  </Badge>
                )}
                {editingItem.stockStatus && (
                  <Badge className={`text-xs ${getStockStatusStyle(editingItem.stockStatus)}`}>
                    {editingItem.stockStatus}
                  </Badge>
                )}
                {isSerialized && (
                  <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-300">
                    Serialized
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Team: {editingItem.teamName}
                </Badge>
              </div>

              {/* Serial number */}
              {isSerialized && editingItem.serialNumber && (
                <div className="text-xs font-mono text-purple-700 bg-purple-50 px-2 py-1 rounded">
                  S/N: {editingItem.serialNumber}
                </div>
              )}

              {/* On Hand quantity */}
              <div className="text-center py-2 bg-muted/30 rounded-lg">
                <div className="text-xs font-medium text-muted-foreground mb-1">On Hand</div>
                <div className="text-3xl font-bold">{onHand}</div>
              </div>

              {/* Quantity input — same style as team counting */}
              {isSerialized ? (
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant={editQty === "0" ? "default" : "outline"}
                    className={`flex-1 h-16 text-lg font-bold ${editQty === "0" ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
                    onClick={() => setEditQty("0")}
                  >
                    0 — Not Found
                  </Button>
                  <Button
                    type="button"
                    variant={editQty === "1" ? "default" : "outline"}
                    className={`flex-1 h-16 text-lg font-bold ${editQty === "1" ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                    onClick={() => setEditQty("1")}
                  >
                    1 — Found
                  </Button>
                </div>
              ) : (
                <Input
                  ref={editInputRef}
                  type="number"
                  inputMode="decimal"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  placeholder="Enter quantity"
                  className="h-20 text-4xl text-center font-semibold"
                  disabled={saving}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveEdit();
                    }
                  }}
                  autoFocus
                />
              )}

              {/* Variance preview */}
              {newVariance !== null && newVariance !== 0 && (
                <div className="text-center text-sm">
                  <span className="text-muted-foreground">Variance: </span>
                  <Badge
                    variant={Math.abs(newVariance) > 10 ? "destructive" : "outline"}
                    className={Math.abs(newVariance) <= 10 ? "border-amber-400 text-amber-700" : ""}
                  >
                    {newVariance > 0 ? "+" : ""}{newVariance}
                  </Badge>
                </div>
              )}

              {/* Add note toggle + reason */}
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setEditShowComment((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {editShowComment ? "Hide note" : "Add note"}
                </button>
              </div>

              {editShowComment && (
                <Textarea
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="e.g. Recounted by supervisor"
                  className="text-sm"
                  rows={2}
                />
              )}

              {/* Submit / Cancel */}
              {isMatchValue ? (
                <Button
                  onClick={saveEdit}
                  className="w-full h-14 text-lg font-bold text-white bg-green-600 hover:bg-green-700"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "MATCH"}
                </Button>
              ) : (
                <Button
                  onClick={saveEdit}
                  className="w-full h-14 text-lg font-bold text-white bg-amber-500 hover:bg-amber-600"
                  disabled={!editQty || saving}
                >
                  {saving ? "Saving..." : "Save Variance"}
                </Button>
              )}

              <Button
                variant="outline"
                onClick={closeEditDialog}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

export function EditSerialDialog({ serialEdit, saving }: { serialEdit: SerialEditing; saving: boolean }) {
  const {
    editingSerialItem,
    editSerialValue,
    setEditSerialValue,
    editSerialInputRef,
    closeEditSerialDialog,
    saveSerialEdit,
  } = serialEdit;

  return (
    <Dialog
      open={editingSerialItem !== null}
      onOpenChange={(open) => {
        if (!open) closeEditSerialDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit Serial Number
          </DialogTitle>
          <DialogDescription>
            Correct the serial number for {editingSerialItem?.itemCode} if it was entered incorrectly.
          </DialogDescription>
        </DialogHeader>

        {editingSerialItem && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="col-span-2">
                <span className="text-muted-foreground">Item: </span>
                <span className="font-medium">{editingSerialItem.itemCode}</span>
                {editingSerialItem.description && (
                  <span className="text-muted-foreground"> — {editingSerialItem.description}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Bin: </span>
                <span>{editingSerialItem.binNumber || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Team: </span>
                <span>{editingSerialItem.teamName}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Current: </span>
                <span className="font-mono font-medium">{editingSerialItem.serialNumber}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-serial">New Serial Number</Label>
              <Input
                id="edit-serial"
                ref={editSerialInputRef}
                value={editSerialValue}
                onChange={(e) => setEditSerialValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSerialEdit();
                }}
                placeholder="Enter corrected serial number"
                autoFocus
                className="font-mono"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={closeEditSerialDialog}>
            Cancel
          </Button>
          <Button onClick={saveSerialEdit} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembers({ members }: { members: string }) {
  return (
    <div className="text-xs text-muted-foreground">
      {(() => { try { return (JSON.parse(members) as string[]).join(", "); } catch { return null; } })()}
    </div>
  );
}

/** Distribute verification counts for the selected variances across teams. */
export function AssignVerificationDialog({ selection }: { selection: VarianceSelection }) {
  const {
    showAssignDialog,
    setShowAssignDialog,
    teams,
    selectedTeamIds,
    selectedCountIds,
    toggleTeamSelection,
    assigning,
    submitAssignment,
  } = selection;

  return (
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
                      {t.members && <TeamMembers members={t.members} />}
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
  );
}

/** Bulk Accept Confirmation Dialog */
export function BulkAcceptDialog({ selection, activeVariances }: { selection: VarianceSelection; activeVariances: VarianceItem[] }) {
  const { showBulkAcceptDialog, setShowBulkAcceptDialog, selectedCountIds, bulkAccepting, handleBulkAccept } = selection;

  return (
    <Dialog open={showBulkAcceptDialog} onOpenChange={(open) => { if (!open) setShowBulkAcceptDialog(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Accept {selectedCountIds.size} Variance{selectedCountIds.size !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            This will mark {selectedCountIds.size} variance{selectedCountIds.size !== 1 ? "s" : ""} as accepted. Accepted variances move to the Accepted tab and will no longer appear as active items requiring review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-semibold">This action affects stock records</p>
            <p className="mt-1 text-xs">
              Accepting a variance means the counted quantity is confirmed as correct.
              The variance between on-hand and counted will stand as the final result.
              You can reopen individual variances later from the Accepted tab if needed.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            Total variance value: <span className="font-medium text-foreground">
              R{selectedVarianceValue(activeVariances, selectedCountIds)}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowBulkAcceptDialog(false)} disabled={bulkAccepting}>
            Cancel
          </Button>
          <Button
            onClick={handleBulkAccept}
            disabled={bulkAccepting}
            className="bg-green-600 hover:bg-green-700 text-white gap-1"
          >
            {bulkAccepting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {bulkAccepting ? "Accepting..." : "Confirm Accept"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Serial Verification Assignment Dialog */
export function SerialVerifyDialog({ serialVerify }: { serialVerify: SerialVerifyAssignment }) {
  const {
    showSerialVerifyDialog,
    serialVerifyItem,
    serialVerifyTeams,
    serialVerifySelectedTeamId,
    setSerialVerifySelectedTeamId,
    serialVerifyAssigning,
    closeSerialVerifyDialog,
    submitSerialVerifyAssignment,
  } = serialVerify;

  return (
    <Dialog
      open={showSerialVerifyDialog}
      onOpenChange={(open) => {
        if (!open) {
          closeSerialVerifyDialog();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Serial Verification</DialogTitle>
          <DialogDescription>
            Choose a team to physically verify the unknown serials for{" "}
            <span className="font-mono font-medium">{serialVerifyItem?.itemCode}</span>
            {serialVerifyItem?.binNumber && (
              <> in bin <span className="font-mono font-medium">{serialVerifyItem.binNumber}</span></>
            )}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label>Select Team</Label>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {serialVerifyTeams.map((t) => (
              <label
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  serialVerifySelectedTeamId === t.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="serial-verify-team"
                  checked={serialVerifySelectedTeamId === t.id}
                  onChange={() => setSerialVerifySelectedTeamId(t.id)}
                  className="h-4 w-4"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t.name}</div>
                  {t.members && <TeamMembers members={t.members} />}
                </div>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={closeSerialVerifyDialog}
          >
            Cancel
          </Button>
          <Button
            onClick={submitSerialVerifyAssignment}
            disabled={serialVerifyAssigning || !serialVerifySelectedTeamId}
          >
            {serialVerifyAssigning ? "Assigning..." : "Assign Verification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
