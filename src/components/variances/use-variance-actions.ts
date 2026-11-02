"use client";

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { AcceptAction, Team, VarianceItem } from "./types";
import type { VariancesData } from "./use-variances-data";
import { distributeVerifications } from "@/lib/verification-distribution";

type SetBool = Dispatch<SetStateAction<boolean>>;

/** Supervisor edit of a counted quantity (Edit dialog). */
export function useVarianceEditing(data: VariancesData, setSaving: SetBool) {
  const { setAcceptedVariances, setActiveVariances, setActiveTotalValue, setResolvedVariances } = data;
  const [editingItem, setEditingItem] = useState<VarianceItem | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editShowComment, setEditShowComment] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

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
    setEditShowComment(false);
  };

  const saveEdit = async () => {
    if (!editingItem) return;

    const newQty = parseFloat(editQty);
    if (isNaN(newQty)) {
      toast.error("Please enter a valid number");
      return;
    }

    if (editingItem.isSerialized && newQty !== 0 && newQty !== 1) {
      toast.error("Serialized items can only be 0 or 1");
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

      const wasAccepted = editingItem.checkStatus === "accepted";

      if (count.isMatch) {
        // Variance resolved — remove from source list, add to resolved
        if (wasAccepted) {
          setAcceptedVariances((prev) =>
            prev.filter((v) => v.countId !== editingItem.countId)
          );
        } else {
          setActiveVariances((prev) =>
            prev.filter((v) => v.countId !== editingItem.countId)
          );
          setActiveTotalValue(
            (prev) => prev - Math.abs(editingItem.varianceValue)
          );
        }
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
      } else if (wasAccepted) {
        // Editing from accepted tab — update in place in accepted list
        setAcceptedVariances((prev) =>
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
        toast.success(
          `${editingItem.itemCode} count updated to ${count.countedQty}`
        );
      } else {
        // Editing from active tab — moves to accepted (API sets checkStatus=accepted)
        setActiveVariances((prev) =>
          prev.filter((v) => v.countId !== editingItem.countId)
        );
        setActiveTotalValue(
          (prev) =>
            prev - Math.abs(editingItem.varianceValue)
        );
        setAcceptedVariances((prev) => [
          {
            ...editingItem,
            countedQty: count.countedQty,
            variance: count.variance,
            varianceValue: count.varianceValue,
            checkStatus: "accepted",
          },
          ...prev,
        ]);
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

  return {
    editingItem,
    editQty,
    setEditQty,
    editReason,
    setEditReason,
    editShowComment,
    setEditShowComment,
    editInputRef,
    openEditDialog,
    closeEditDialog,
    saveEdit,
  };
}

export type VarianceEditing = ReturnType<typeof useVarianceEditing>;

/** Correct the serial number of an unknown / approved serial (Edit Serial dialog). */
export function useSerialEditing(loadVariances: () => void, setSaving: SetBool) {
  const [editingSerialItem, setEditingSerialItem] = useState<VarianceItem | null>(null);
  const [editSerialValue, setEditSerialValue] = useState("");
  const editSerialInputRef = useRef<HTMLInputElement>(null);

  // Focus serial edit input when dialog opens
  useEffect(() => {
    if (editingSerialItem && editSerialInputRef.current) {
      setTimeout(() => editSerialInputRef.current?.select(), 50);
    }
  }, [editingSerialItem]);

  // Edit an unknown serial number
  const openEditSerialDialog = (v: VarianceItem) => {
    setEditingSerialItem(v);
    setEditSerialValue(v.serialNumber || "");
  };

  const closeEditSerialDialog = () => {
    setEditingSerialItem(null);
    setEditSerialValue("");
  };

  const saveSerialEdit = async () => {
    if (!editingSerialItem) return;
    const trimmed = editSerialValue.trim();
    if (!trimmed) {
      toast.error("Serial number cannot be empty");
      return;
    }
    if (trimmed === editingSerialItem.serialNumber) {
      closeEditSerialDialog();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingSerialItem.isApprovedSerial ? "edit_approved_serial" : "edit_unknown_serial",
          countId: editingSerialItem.countId,
          serial: editingSerialItem.serialNumber,
          newSerial: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update serial");
        return;
      }

      toast.success(`Serial updated to ${trimmed}`);
      loadVariances();
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSaving(false);
      closeEditSerialDialog();
    }
  };

  return {
    editingSerialItem,
    editSerialValue,
    setEditSerialValue,
    editSerialInputRef,
    openEditSerialDialog,
    closeEditSerialDialog,
    saveSerialEdit,
  };
}

export type SerialEditing = ReturnType<typeof useSerialEditing>;

/** Per-row actions: accept original/verification, accept/reopen variance, approve/dismiss unknown serial. */
export function useVarianceRowActions(data: VariancesData, setSaving: SetBool) {
  const { loadVariances, setActiveVariances, setAcceptedVariances } = data;

  // Accept original/verification
  const handleAccept = async (
    action: AcceptAction,
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

  // Accept a variance (move from active to accepted)
  const handleAcceptVariance = async (v: VarianceItem) => {
    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_variance", countId: v.countId }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to accept variance");
        return;
      }

      // Optimistic move from active to accepted
      setActiveVariances((prev) =>
        prev.filter((item) => item.countId !== v.countId)
      );
      setAcceptedVariances((prev) => [
        { ...v, checkStatus: "accepted" },
        ...prev,
      ]);
      toast.success(`${v.itemCode} variance accepted`);
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSaving(false);
    }
  };

  // Reopen a variance (move from accepted back to active)
  const handleReopenVariance = async (v: VarianceItem) => {
    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen_variance", countId: v.countId }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to reopen variance");
        return;
      }

      // Optimistic move from accepted to active
      setAcceptedVariances((prev) =>
        prev.filter((item) => item.countId !== v.countId)
      );
      setActiveVariances((prev) => [
        { ...v, checkStatus: "pending" },
        ...prev,
      ]);
      toast.success(`${v.itemCode} moved back to active`);
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSaving(false);
    }
  };

  // Approve an unknown serial (moves to accepted)
  const handleApproveUnknownSerial = async (v: VarianceItem) => {
    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_unknown_serial", countId: v.countId, serial: v.serialNumber }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to approve serial");
        return;
      }

      toast.success(`Serial ${v.serialNumber} approved`);
      loadVariances();
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSaving(false);
    }
  };

  // Dismiss an unknown serial (removes from active)
  const handleDismissUnknownSerial = async (v: VarianceItem) => {
    setSaving(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_unknown_serial", countId: v.countId, serial: v.serialNumber }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to dismiss serial");
        return;
      }

      toast.success(`Serial ${v.serialNumber} dismissed`);
      loadVariances();
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSaving(false);
    }
  };

  return {
    handleAccept,
    handleAcceptVariance,
    handleReopenVariance,
    handleApproveUnknownSerial,
    handleDismissUnknownSerial,
  };
}

/**
 * Multi-select of active variances (checkboxes, select-all, value threshold) and the
 * two bulk operations on the selection: distribute verification counts, bulk accept.
 */
export function useVarianceSelection(
  data: VariancesData,
  filterItems: (items: VarianceItem[]) => VarianceItem[]
) {
  const { activeVariances, setActiveVariances, setAcceptedVariances, loadVariances } = data;

  // Verification selection state
  const [selectedCountIds, setSelectedCountIds] = useState<Set<number>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [thresholdValue, setThresholdValue] = useState("");
  const [thresholdMode, setThresholdMode] = useState<"gte" | "lte">("gte");

  // Bulk accept state
  const [showBulkAcceptDialog, setShowBulkAcceptDialog] = useState(false);
  const [bulkAccepting, setBulkAccepting] = useState(false);

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

  const selectByThreshold = () => {
    const threshold = parseFloat(thresholdValue);
    if (isNaN(threshold) || threshold < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const matching = filterItems(selectableItems).filter((v) =>
      thresholdMode === "gte"
        ? Math.abs(v.varianceValue) >= threshold
        : Math.abs(v.varianceValue) <= threshold
    );
    if (matching.length === 0) {
      toast.info(`No variances ${thresholdMode === "gte" ? "above" : "below"} R${threshold}`);
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

  // Items the assignment would send, and how they split across the selected teams.
  // The dialog preview reads this so its per-team counts match what is submitted.
  const assignmentItems = activeVariances.filter((v) => selectedCountIds.has(v.countId));
  const assignmentPreview = distributeVerifications(assignmentItems, Array.from(selectedTeamIds));

  const submitAssignment = async () => {
    if (selectedTeamIds.size === 0) {
      toast.error("Select at least one team");
      return;
    }

    setAssigning(true);
    try {
      const teamIds = Array.from(selectedTeamIds);
      // Distribute items across teams, avoiding the team that originally counted each item
      const teamChunks = distributeVerifications(assignmentItems, teamIds);

      let totalCreated = 0;
      const succeededTeamIds: number[] = [];
      const failedTeamNames: string[] = [];
      const assignedCountIds = new Set<number>();
      const teamName = (tid: number) => teams.find((t) => t.id === tid)?.name ?? `Team ${tid}`;

      for (const [teamId, countIds] of Array.from(teamChunks.entries())) {
        if (countIds.length === 0) continue;
        try {
          const res = await fetch("/api/supervisor/verifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ countIds, assignedTeamId: teamId }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(`${teamName(teamId)}: ${data.error || "Failed to assign"}`);
            failedTeamNames.push(teamName(teamId));
            continue;
          }
          totalCreated += data.created ?? 0;
          succeededTeamIds.push(teamId);
          for (const id of countIds) assignedCountIds.add(id);
        } catch {
          toast.error(`${teamName(teamId)}: failed to assign — check your connection`);
          failedTeamNames.push(teamName(teamId));
        }
      }

      const created = `${totalCreated} verification${totalCreated !== 1 ? "s" : ""}`;
      if (failedTeamNames.length === 0) {
        toast.success(`${created} distributed across ${succeededTeamIds.map(teamName).join(", ")}`);
        setSelectedCountIds(new Set());
        setShowAssignDialog(false);
      } else if (succeededTeamIds.length > 0) {
        // Partial failure: keep the failed teams' items selected so they can be retried
        toast.warning(
          `${created} assigned to ${succeededTeamIds.map(teamName).join(", ")}; failed for ${failedTeamNames.join(", ")}. Unassigned items remain selected.`
        );
        setSelectedCountIds((prev) => new Set(Array.from(prev).filter((id) => !assignedCountIds.has(id))));
        setShowAssignDialog(false);
      }
      // All failed: per-team error toasts already shown; keep dialog and selection
      if (succeededTeamIds.length > 0) loadVariances();
    } finally {
      setAssigning(false);
    }
  };

  // Bulk accept selected variances
  const handleBulkAccept = async () => {
    // Unknown-serial rows use synthetic negative ids and can't be bulk-accepted
    const ids = Array.from(selectedCountIds).filter((id) => id > 0);
    if (ids.length === 0) {
      toast.error("No count variances selected — unknown serials must be approved individually");
      setShowBulkAcceptDialog(false);
      return;
    }
    setBulkAccepting(true);
    try {
      const res = await fetch("/api/supervisor/variances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk_accept_variance", countIds: ids }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to accept variances");
        return;
      }
      const data = await res.json();
      // Optimistic move from active to accepted
      const acceptedIds = new Set(ids);
      const moved = activeVariances.filter((v) => acceptedIds.has(v.countId));
      setActiveVariances((prev) => prev.filter((v) => !acceptedIds.has(v.countId)));
      setAcceptedVariances((prev) => [
        ...moved.map((v) => ({ ...v, checkStatus: "accepted" })),
        ...prev,
      ]);
      setSelectedCountIds(new Set());
      toast.success(`${data.acceptedCount} variance${data.acceptedCount !== 1 ? "s" : ""} accepted`);
    } catch {
      toast.error("Failed to accept — check your connection");
    } finally {
      setBulkAccepting(false);
      setShowBulkAcceptDialog(false);
    }
  };

  return {
    selectedCountIds,
    setSelectedCountIds,
    selectableItems,
    toggleSelection,
    toggleSelectAll,
    canSelect,
    thresholdValue,
    setThresholdValue,
    thresholdMode,
    setThresholdMode,
    selectByThreshold,
    // assign verification
    showAssignDialog,
    setShowAssignDialog,
    teams,
    selectedTeamIds,
    assignmentPreview,
    toggleTeamSelection,
    assigning,
    openAssignDialog,
    submitAssignment,
    // bulk accept
    showBulkAcceptDialog,
    setShowBulkAcceptDialog,
    bulkAccepting,
    handleBulkAccept,
  };
}

export type VarianceSelection = ReturnType<typeof useVarianceSelection>;

/** Assign a team to physically verify an item's unknown serials. */
export function useSerialVerifyAssignment(loadVariances: () => void) {
  const [showSerialVerifyDialog, setShowSerialVerifyDialog] = useState(false);
  const [serialVerifyItem, setSerialVerifyItem] = useState<VarianceItem | null>(null);
  const [serialVerifyTeams, setSerialVerifyTeams] = useState<Team[]>([]);
  const [serialVerifySelectedTeamId, setSerialVerifySelectedTeamId] = useState<number | null>(null);
  const [serialVerifyAssigning, setSerialVerifyAssigning] = useState(false);

  // Open serial verify dialog — fetch teams + show dialog
  const openSerialVerifyDialog = async (v: VarianceItem) => {
    if (!v.discrepancyId) return;
    setSerialVerifyItem(v);
    setSerialVerifySelectedTeamId(null);
    try {
      const res = await fetch("/api/supervisor/teams");
      if (res.ok) {
        const data = await res.json();
        setSerialVerifyTeams(data.teams || []);
      }
    } catch {
      toast.error("Failed to load teams");
    }
    setShowSerialVerifyDialog(true);
  };

  const closeSerialVerifyDialog = () => {
    setShowSerialVerifyDialog(false);
    setSerialVerifyItem(null);
  };

  const submitSerialVerifyAssignment = async () => {
    if (!serialVerifyItem?.discrepancyId || !serialVerifySelectedTeamId) return;
    setSerialVerifyAssigning(true);
    try {
      const res = await fetch("/api/supervisor/serial-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discrepancyId: serialVerifyItem.discrepancyId,
          action: "assign-verification",
          assignedTeamId: serialVerifySelectedTeamId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to assign verification");
        return;
      }

      const teamName = serialVerifyTeams.find((t) => t.id === serialVerifySelectedTeamId)?.name;
      toast.success(`Verification assigned to ${teamName}`);
      setShowSerialVerifyDialog(false);
      setSerialVerifyItem(null);
      loadVariances();
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSerialVerifyAssigning(false);
    }
  };

  return {
    showSerialVerifyDialog,
    serialVerifyItem,
    serialVerifyTeams,
    serialVerifySelectedTeamId,
    setSerialVerifySelectedTeamId,
    serialVerifyAssigning,
    openSerialVerifyDialog,
    closeSerialVerifyDialog,
    submitSerialVerifyAssignment,
  };
}

export type SerialVerifyAssignment = ReturnType<typeof useSerialVerifyAssignment>;
