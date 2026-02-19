"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Search, ClipboardCheck, ChevronRight, ChevronDown, Check, RotateCcw, X as XIcon, Pencil, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { markNotificationSeen } from "@/hooks/use-notifications";
import { groupSerializedVariances, type SerializedGroupRow } from "@/lib/variance-grouping";
import { getStockStatusStyle } from "@/components/counting/item-card";

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
  // Serial fields
  isSerialized?: boolean | number | null;
  isUnknownSerial?: boolean;
  isApprovedSerial?: boolean;
  serialNumber?: string;
  discrepancyId?: number;
  serialIndex?: number;
  stockStatus?: string | null;
  // Serial verification fields
  serialVerificationStatus?: string | null;
  serialVerificationTeamId?: number | null;
  serialVerificationTeamName?: string | null;
  serialVerificationResult?: string | null; // "confirmed" | "not_found"
}

interface Team {
  id: number;
  name: string;
  members: string | null;
}

interface EventOption {
  id: number;
  name: string;
  status: string;
}

export default function VariancesPage() {
  const { user } = useAuth();
  const isAuditor = user?.type === "auditor" || user?.type === "executive";
  const isExecutive = user?.type === "executive";
  const searchParams = useSearchParams();

  // Executive event picker
  const [execEvents, setExecEvents] = useState<EventOption[]>([]);
  const [execEventId, setExecEventId] = useState<number>(0);

  const [activeVariances, setActiveVariances] = useState<VarianceItem[]>([]);
  const [acceptedVariances, setAcceptedVariances] = useState<VarianceItem[]>([]);
  const [resolvedVariances, setResolvedVariances] = useState<VarianceItem[]>([]);
  const [activeTotalValue, setActiveTotalValue] = useState(0);
  const [overCount, setOverCount] = useState(0);
  const [underCount, setUnderCount] = useState(0);
  const [overValue, setOverValue] = useState(0);
  const [underValue, setUnderValue] = useState(0);
  const [netVarianceValue, setNetVarianceValue] = useState(0);
  // Accepted tab stats
  const [acceptedTotalValue, setAcceptedTotalValue] = useState(0);
  const [acceptedOverCount, setAcceptedOverCount] = useState(0);
  const [acceptedUnderCount, setAcceptedUnderCount] = useState(0);
  const [acceptedOverValue, setAcceptedOverValue] = useState(0);
  const [acceptedUnderValue, setAcceptedUnderValue] = useState(0);
  const [acceptedNetVarianceValue, setAcceptedNetVarianceValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"contains" | "starts" | "exact" | "bin">("contains");
  const [activeTab, setActiveTab] = useState("active");

  // Edit dialog state
  const [editingItem, setEditingItem] = useState<VarianceItem | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editShowComment, setEditShowComment] = useState(false);
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Verification selection state
  const [selectedCountIds, setSelectedCountIds] = useState<Set<number>>(new Set());
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [thresholdValue, setThresholdValue] = useState("");
  const [serialFilter, setSerialFilter] = useState(searchParams.get("filter") === "serials");

  // Edit serial dialog state
  const [editingSerialItem, setEditingSerialItem] = useState<VarianceItem | null>(null);
  const [editSerialValue, setEditSerialValue] = useState("");
  const editSerialInputRef = useRef<HTMLInputElement>(null);

  // Serial verification assignment state
  const [showSerialVerifyDialog, setShowSerialVerifyDialog] = useState(false);
  const [serialVerifyItem, setSerialVerifyItem] = useState<VarianceItem | null>(null);
  const [serialVerifyTeams, setSerialVerifyTeams] = useState<Team[]>([]);
  const [serialVerifySelectedTeamId, setSerialVerifySelectedTeamId] = useState<number | null>(null);
  const [serialVerifyAssigning, setSerialVerifyAssigning] = useState(false);

  // Fetch events list for executive event picker
  useEffect(() => {
    if (!isExecutive) return;
    (async () => {
      try {
        const res = await fetch("/api/executive/dashboard");
        if (res.ok) {
          const data = await res.json();
          const evts: EventOption[] = (data.events || []).map((e: { id: number; name: string; status: string }) => ({ id: e.id, name: e.name, status: e.status }));
          setExecEvents(evts);
          if (evts.length > 0 && execEventId === 0) {
            const active = evts.find((e) => e.status === "active");
            setExecEventId(active?.id ?? evts[0].id);
          }
        }
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecutive]);

  const loadVariances = useCallback(async () => {
    // Executive must pick an event first
    if (isExecutive && !execEventId) return;

    const eidParam = isExecutive ? `eventId=${execEventId}&` : "";
    try {
      const [activeRes, acceptedRes, resolvedRes] = await Promise.all([
        fetch(`/api/supervisor/variances?${eidParam}`),
        fetch(`/api/supervisor/variances?${eidParam}tab=accepted`),
        fetch(`/api/supervisor/variances?${eidParam}tab=resolved`),
      ]);

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveVariances(data.variances || []);
        setActiveTotalValue(data.totalVarianceValue || 0);
        setOverCount(data.overCount || 0);
        setUnderCount(data.underCount || 0);
        setOverValue(data.overValue || 0);
        setUnderValue(data.underValue || 0);
        setNetVarianceValue(data.netVarianceValue || 0);
      }

      if (acceptedRes.ok) {
        const data = await acceptedRes.json();
        setAcceptedVariances(data.variances || []);
        setAcceptedTotalValue(data.totalVarianceValue || 0);
        setAcceptedOverCount(data.overCount || 0);
        setAcceptedUnderCount(data.underCount || 0);
        setAcceptedOverValue(data.overValue || 0);
        setAcceptedUnderValue(data.underValue || 0);
        setAcceptedNetVarianceValue(data.netVarianceValue || 0);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecutive, execEventId]);

  useEffect(() => {
    loadVariances();
    const interval = setInterval(loadVariances, 15000);
    return () => clearInterval(interval);
  }, [loadVariances]);

  // Mark serials as seen when serial filter is active
  useEffect(() => {
    if (serialFilter) {
      markNotificationSeen("supervisorSerials");
    }
  }, [serialFilter]);

  // Focus edit input when dialog opens
  useEffect(() => {
    if (editingItem && editInputRef.current) {
      setTimeout(() => editInputRef.current?.select(), 50);
    }
  }, [editingItem]);

  // Focus serial edit input when dialog opens
  useEffect(() => {
    if (editingSerialItem && editSerialInputRef.current) {
      setTimeout(() => editSerialInputRef.current?.select(), 50);
    }
  }, [editingSerialItem]);

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
        body: JSON.stringify({ action: "approve_unknown_serial", countId: v.countId }),
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
        body: JSON.stringify({ action: "dismiss_unknown_serial", countId: v.countId }),
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

  const applySerialFilter = (items: VarianceItem[]) => {
    if (!serialFilter) return items;
    return items.filter((v) => v.isUnknownSerial || v.isApprovedSerial);
  };

  const filteredActive = applySerialFilter(filterItems(activeVariances));
  const filteredAccepted = applySerialFilter(filterItems(acceptedVariances));
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
  const unknownSerialCount = activeVariances.filter(
    (v) => v.isUnknownSerial
  ).length;

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
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
        {activeTab !== "resolved" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
              {activeTab === "accepted" ? acceptedOverCount : overCount} over R{(activeTab === "accepted" ? acceptedOverValue : overValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Badge>
            <span className="text-muted-foreground text-xs">·</span>
            <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">
              {activeTab === "accepted" ? acceptedUnderCount : underCount} under R{(activeTab === "accepted" ? acceptedUnderValue : underValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Badge>
            <span className="text-muted-foreground text-xs">·</span>
            <Badge className={`text-xs ${(activeTab === "accepted" ? acceptedNetVarianceValue : netVarianceValue) >= 0 ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}`}>
              Net: {(activeTab === "accepted" ? acceptedNetVarianceValue : netVarianceValue) >= 0 ? "" : "-"}R{Math.abs(activeTab === "accepted" ? acceptedNetVarianceValue : netVarianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Badge>
            <span className="text-muted-foreground text-xs">·</span>
            <Badge variant="destructive" className="text-xs">
              R{(activeTab === "accepted" ? acceptedTotalValue : activeTotalValue).toLocaleString(undefined, { maximumFractionDigits: 0 })} total
            </Badge>
          </div>
        )}
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
        <div className="flex items-center gap-1.5 flex-wrap">
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
          <div className="h-4 w-px bg-border mx-1" />
          <button
            onClick={() => setSerialFilter((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              serialFilter
                ? "bg-amber-500 text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Serials
            {unknownSerialCount > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold ${
                serialFilter ? "bg-white/30 text-white" : "bg-amber-100 text-amber-800"
              }`}>
                {unknownSerialCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="active" className="flex-1">
            Active ({activeVariances.length})
          </TabsTrigger>
          <TabsTrigger value="accepted" className="flex-1">
            Accepted ({acceptedVariances.length})
          </TabsTrigger>
          <TabsTrigger value="resolved" className="flex-1">
            Resolved ({resolvedVariances.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {/* Selection toolbar */}
          {!isAuditor && activeVariances.length > 0 && (
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
              search ? "No matching variances" : serialFilter ? "No unknown serials" : "No variances recorded"
            }
            showEditButton={!isAuditor}
            showCheckbox={!isAuditor}
            showAcceptButton={!isAuditor}
            onEdit={isAuditor ? undefined : openEditDialog}
            selectedCountIds={isAuditor ? undefined : selectedCountIds}
            onToggleSelect={isAuditor ? undefined : toggleSelection}
            canSelect={isAuditor ? undefined : canSelect}
            onAccept={isAuditor ? undefined : handleAccept}
            onAcceptVariance={isAuditor ? undefined : handleAcceptVariance}
            onApproveUnknownSerial={isAuditor ? undefined : handleApproveUnknownSerial}
            onDismissUnknownSerial={isAuditor ? undefined : handleDismissUnknownSerial}
            onEditUnknownSerial={isAuditor ? undefined : openEditSerialDialog}
            onSerialVerify={isAuditor ? undefined : openSerialVerifyDialog}
            isSaving={saving}
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredActive.length} variance
            {filteredActive.length !== 1 ? "s" : ""}
          </div>
        </TabsContent>

        <TabsContent value="accepted">
          <VarianceTable
            items={filteredAccepted}
            emptyMessage={
              search
                ? "No matching accepted variances"
                : serialFilter ? "No approved serials" : "No accepted variances yet"
            }
            showEditButton={!isAuditor}
            showCheckbox={false}
            showReopenButton={!isAuditor}
            onEdit={isAuditor ? undefined : openEditDialog}
            onReopenVariance={isAuditor ? undefined : handleReopenVariance}
            onEditUnknownSerial={isAuditor ? undefined : openEditSerialDialog}
            isSaving={saving}
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredAccepted.length} accepted
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
            groupsCollapsed
            isResolvedTab
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredResolved.length} resolved
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog — matches team counting interface */}
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

      {/* Edit Serial Dialog */}
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
                        {t.members && (
                          <div className="text-xs text-muted-foreground">
                            {(() => { try { return (JSON.parse(t.members) as string[]).join(", "); } catch { return null; } })()}
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

      {/* Serial Verification Assignment Dialog */}
      <Dialog
        open={showSerialVerifyDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowSerialVerifyDialog(false);
            setSerialVerifyItem(null);
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
                    {t.members && (
                      <div className="text-xs text-muted-foreground">
                        {(() => { try { return (JSON.parse(t.members) as string[]).join(", "); } catch { return null; } })()}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowSerialVerifyDialog(false);
                setSerialVerifyItem(null);
              }}
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
    </div>
  );
}

// Shared table component for both tabs
function VarianceTable({
  items,
  emptyMessage,
  showEditButton,
  showCheckbox,
  showAcceptButton,
  showReopenButton,
  groupsCollapsed,
  isResolvedTab,
  onEdit,
  selectedCountIds,
  onToggleSelect,
  canSelect,
  onAccept,
  onAcceptVariance,
  onReopenVariance,
  onApproveUnknownSerial,
  onDismissUnknownSerial,
  onEditUnknownSerial,
  onSerialVerify,
  isSaving,
}: {
  items: VarianceItem[];
  emptyMessage: string;
  showEditButton: boolean;
  showCheckbox: boolean;
  showAcceptButton?: boolean;
  showReopenButton?: boolean;
  groupsCollapsed?: boolean;
  isResolvedTab?: boolean;
  onEdit?: (item: VarianceItem) => void;
  selectedCountIds?: Set<number>;
  onToggleSelect?: (countId: number) => void;
  canSelect?: (item: VarianceItem) => boolean;
  onAccept?: (
    action: "accept_original" | "accept_verification",
    item: VarianceItem
  ) => void;
  onAcceptVariance?: (item: VarianceItem) => void;
  onReopenVariance?: (item: VarianceItem) => void;
  onApproveUnknownSerial?: (item: VarianceItem) => void;
  onDismissUnknownSerial?: (item: VarianceItem) => void;
  onEditUnknownSerial?: (item: VarianceItem) => void;
  onSerialVerify?: (item: VarianceItem) => void;
  isSaving?: boolean;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const displayRows = useMemo(
    () => groupSerializedVariances(items),
    [items]
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroupCheckbox = (group: SerializedGroupRow<VarianceItem>) => {
    if (!onToggleSelect) return;
    const allSelected = group.countIds.every((id) => selectedCountIds?.has(id));
    for (const id of group.countIds) {
      const item = group.items.find((i) => i.countId === id);
      if (item && canSelect?.(item)) {
        if (allSelected) {
          // Deselect all
          if (selectedCountIds?.has(id)) onToggleSelect(id);
        } else {
          // Select all
          if (!selectedCountIds?.has(id)) onToggleSelect(id);
        }
      }
    }
  };

  const colSpan = (showCheckbox ? 1 : 0) + 9 + (showEditButton ? 1 : 0);

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
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colSpan}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row) => {
                  if (row.type === "single") {
                    return renderSingleRow(row.item, {
                      showEditButton,
                      showCheckbox,
                      showAcceptButton,
                      showReopenButton,
                      isResolvedTab,
                      onEdit,
                      selectedCountIds,
                      onToggleSelect,
                      canSelect,
                      onAccept,
                      onAcceptVariance,
                      onReopenVariance,
                      onApproveUnknownSerial,
                      onDismissUnknownSerial,
                      onEditUnknownSerial,
                      onSerialVerify,
                      isSaving,
                    });
                  }

                  // Serialized group
                  const groupKey = `${row.itemCode}::${row.binNumber || ""}`;
                  const isExpanded = !groupsCollapsed && expandedGroups.has(groupKey);
                  const selectableInGroup = row.items.filter((i) => canSelect?.(i));
                  const allGroupSelected =
                    selectableInGroup.length > 0 &&
                    selectableInGroup.every((i) => selectedCountIds?.has(i.countId));

                  return (
                    <React.Fragment key={groupKey}>
                      {/* Group header row */}
                      <TableRow
                        className={`bg-purple-50/60 ${groupsCollapsed ? "" : "hover:bg-purple-100/60 cursor-pointer"}`}
                        onClick={groupsCollapsed ? undefined : () => toggleGroup(groupKey)}
                      >
                        {showCheckbox && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {selectableInGroup.length > 0 && (
                              <input
                                type="checkbox"
                                checked={allGroupSelected}
                                onChange={() => toggleGroupCheckbox(row)}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm">
                          <div className="flex items-center gap-1.5">
                            {!groupsCollapsed && (
                              isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-purple-600 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-purple-600 flex-shrink-0" />
                              )
                            )}
                            <span>{row.itemCode}</span>
                            <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-[10px]">
                              {row.items.length} serials
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
                          {row.description}
                        </TableCell>
                        <TableCell className="text-sm">{row.binNumber}</TableCell>
                        <TableCell className="text-right">{row.totalOnHand}</TableCell>
                        <TableCell className="text-right font-semibold">{row.totalCounted}</TableCell>
                        <TableCell className="text-right">
                          {!isResolvedTab ? (
                            <Badge
                              variant={Math.abs(row.totalVariance) > 10 ? "destructive" : "outline"}
                              className={Math.abs(row.totalVariance) <= 10 ? "border-amber-400 text-amber-700" : ""}
                            >
                              {row.totalVariance > 0 ? "+" : ""}{row.totalVariance}
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-800 border-green-300">
                              {row.totalVariance > 0 ? "+" : ""}{row.totalVariance} Resolved
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right hidden md:table-cell text-sm">
                          R{Math.abs(row.totalVarianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-sm">{row.teamName}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex gap-1 flex-wrap">
                            {row.foundCount > 0 && (
                              <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px]">
                                {row.foundCount} found
                              </Badge>
                            )}
                            {row.notFoundCount > 0 && (
                              <Badge className="bg-red-100 text-red-800 border-red-300 text-[10px]">
                                {row.notFoundCount} not found
                              </Badge>
                            )}
                            {row.unknownSerialCount > 0 && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">
                                {row.unknownSerialCount} unknown
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {showEditButton && <TableCell></TableCell>}
                      </TableRow>

                      {/* Expanded sub-rows */}
                      {isExpanded && row.items.map((v) => renderSubRow(v, {
                        showEditButton,
                        showCheckbox,
                        showAcceptButton,
                        showReopenButton,
                        isResolvedTab,
                        onEdit,
                        selectedCountIds,
                        onToggleSelect,
                        canSelect,
                        onAccept,
                        onAcceptVariance,
                        onReopenVariance,
                        onApproveUnknownSerial,
                        onDismissUnknownSerial,
                        onEditUnknownSerial,
                        onSerialVerify,
                        isSaving,
                      }))}
                    </React.Fragment>
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

// Render helpers for variance rows
interface RowProps {
  showEditButton: boolean;
  showCheckbox: boolean;
  showAcceptButton?: boolean;
  showReopenButton?: boolean;
  isResolvedTab?: boolean;
  onEdit?: (item: VarianceItem) => void;
  selectedCountIds?: Set<number>;
  onToggleSelect?: (countId: number) => void;
  canSelect?: (item: VarianceItem) => boolean;
  onAccept?: (action: "accept_original" | "accept_verification", item: VarianceItem) => void;
  onAcceptVariance?: (item: VarianceItem) => void;
  onReopenVariance?: (item: VarianceItem) => void;
  onApproveUnknownSerial?: (item: VarianceItem) => void;
  onDismissUnknownSerial?: (item: VarianceItem) => void;
  onEditUnknownSerial?: (item: VarianceItem) => void;
  onSerialVerify?: (item: VarianceItem) => void;
  isSaving?: boolean;
}

function renderSingleRow(v: VarianceItem, props: RowProps) {
  const { showEditButton, showCheckbox, showAcceptButton, showReopenButton, isResolvedTab, onEdit, selectedCountIds, onToggleSelect, canSelect, onAccept, onAcceptVariance, onReopenVariance, onApproveUnknownSerial, onDismissUnknownSerial, onEditUnknownSerial, onSerialVerify, isSaving } = props;
  const isSelectable = canSelect ? canSelect(v) : false;
  const isSelected = selectedCountIds?.has(v.countId) ?? false;
  const hasVerification = !!v.verificationId;
  const isVerificationCompleted = v.verificationStatus === "completed";
  const isVerificationAccepted = v.verificationStatus === "accepted";
  const isVerificationPending = v.verificationStatus === "pending";

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
    <TableRow key={v.countId} className={rowBg}>
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
        {v.serialNumber && (
          <Badge className={`${v.isUnknownSerial ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-purple-100 text-purple-800 border-purple-300"} text-[10px] mt-0.5 font-mono`}>
            S/N: {v.serialNumber}
          </Badge>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
        {v.description}
      </TableCell>
      <TableCell className="text-sm">{v.binNumber}</TableCell>
      <TableCell className="text-right">{v.onHand}</TableCell>
      <TableCell className="text-right font-semibold">{v.countedQty}</TableCell>
      <TableCell className="text-right">
        {!isResolvedTab ? (
          <Badge
            variant={Math.abs(v.variance) > 10 ? "destructive" : "outline"}
            className={Math.abs(v.variance) <= 10 ? "border-amber-400 text-amber-700" : ""}
          >
            {v.variance > 0 ? "+" : ""}{v.variance}
          </Badge>
        ) : (
          <Badge className="bg-green-100 text-green-800 border-green-300">
            {v.variance > 0 ? "+" : ""}{v.variance} Resolved
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right hidden md:table-cell text-sm">
        R{Math.abs(v.varianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-sm">{v.teamName}</TableCell>
      <TableCell className="text-sm">
        {v.isUnknownSerial && !v.isApprovedSerial && (
          <div className="space-y-1">
            {v.serialVerificationStatus === "completed" && v.serialVerificationResult ? (
              <Badge className={`text-xs ${v.serialVerificationResult === "confirmed" ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}`}>
                {v.serialVerificationResult === "confirmed" ? "Confirmed Present" : "Not Found"}
              </Badge>
            ) : v.serialVerificationStatus === "pending" ? (
              <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
                Verifying — {v.serialVerificationTeamName}
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
                Unknown Serial
              </Badge>
            )}
            <div className="flex items-center gap-1">
              {onApproveUnknownSerial && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                    onClick={() => onEditUnknownSerial?.(v)}
                    disabled={isSaving || v.serialVerificationStatus === "pending"}
                    title="Edit serial number"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  {v.serialVerificationStatus !== "pending" && onSerialVerify && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-1.5 text-purple-700 border-purple-300 hover:bg-purple-50"
                      onClick={() => onSerialVerify(v)}
                      disabled={isSaving}
                      title={v.serialVerificationStatus === "completed" ? "Re-assign verification" : "Assign verification"}
                    >
                      <ClipboardCheck className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => onApproveUnknownSerial(v)}
                    disabled={isSaving || v.serialVerificationStatus === "pending"}
                    title="Approve serial"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-red-700 border-red-300 hover:bg-red-50"
                    onClick={() => onDismissUnknownSerial?.(v)}
                    disabled={isSaving || v.serialVerificationStatus === "pending"}
                    title="Dismiss serial"
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {v.isApprovedSerial && (
          <div className="space-y-1">
            <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
              Approved Serial
            </Badge>
            {onEditUnknownSerial && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={() => onEditUnknownSerial(v)}
                  disabled={isSaving}
                  title="Edit serial number"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
        {!v.isUnknownSerial && !v.isApprovedSerial && !hasVerification && (
          <span className="text-muted-foreground">—</span>
        )}
        {!v.isUnknownSerial && !v.isApprovedSerial && isVerificationPending && (
          <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
            Pending — {v.verificationTeamName}
          </Badge>
        )}
        {!v.isUnknownSerial && !v.isApprovedSerial && isVerificationCompleted && (
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
                onClick={() => onAccept?.("accept_original", v)}
                disabled={isSaving}
              >
                Keep Original
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onAccept?.("accept_verification", v)}
                disabled={isSaving}
              >
                Accept Verified
              </Button>
            </div>
          </div>
        )}
        {!v.isUnknownSerial && !v.isApprovedSerial && isVerificationAccepted && (
          <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
            Verification Resolved
          </Badge>
        )}
      </TableCell>
      {showEditButton && (
        <TableCell>
          {!v.isUnknownSerial && !v.isApprovedSerial && (
            <div className="flex items-center gap-1">
              {showAcceptButton && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2 text-green-700 border-green-300 hover:bg-green-50"
                  onClick={() => onAcceptVariance?.(v)}
                  disabled={isSaving}
                  title="Accept variance"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
              {showReopenButton && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                  onClick={() => onReopenVariance?.(v)}
                  disabled={isSaving}
                  title="Reopen variance"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onEdit?.(v)}
              >
                Edit
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function renderSubRow(v: VarianceItem, props: RowProps) {
  const { showEditButton, showCheckbox, showAcceptButton, showReopenButton, isResolvedTab, onEdit, selectedCountIds, onToggleSelect, canSelect, onAccept, onAcceptVariance, onReopenVariance, onApproveUnknownSerial, onDismissUnknownSerial, onEditUnknownSerial, onSerialVerify, isSaving } = props;
  const isSelectable = canSelect ? canSelect(v) : false;
  const isSelected = selectedCountIds?.has(v.countId) ?? false;
  const hasVerification = !!v.verificationId;
  const isVerificationCompleted = v.verificationStatus === "completed";
  const isVerificationAccepted = v.verificationStatus === "accepted";
  const isVerificationPending = v.verificationStatus === "pending";
  const isUnknown = v.isUnknownSerial;
  const found = v.countedQty > 0;

  return (
    <TableRow
      key={v.countId}
      className={`${isSelected ? "bg-blue-50" : isUnknown ? "bg-amber-50/30" : "bg-purple-50/20"}`}
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
      <TableCell className="font-mono text-sm pl-10">
        {v.serialNumber ? (
          <Badge className={`${isUnknown ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-purple-100 text-purple-800 border-purple-300"} text-[10px] font-mono`}>
            S/N: {v.serialNumber}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">No S/N</span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate text-muted-foreground">
        {isUnknown ? "Unknown serial" : found ? "Found" : "Not found"}
      </TableCell>
      <TableCell className="text-sm"></TableCell>
      <TableCell className="text-right">{v.onHand}</TableCell>
      <TableCell className="text-right font-semibold">{v.countedQty}</TableCell>
      <TableCell className="text-right">
        {!isResolvedTab ? (
          <Badge
            variant={Math.abs(v.variance) > 10 ? "destructive" : "outline"}
            className={Math.abs(v.variance) <= 10 ? "border-amber-400 text-amber-700" : ""}
          >
            {v.variance > 0 ? "+" : ""}{v.variance}
          </Badge>
        ) : (
          <Badge className="bg-green-100 text-green-800 border-green-300">
            {v.variance > 0 ? "+" : ""}{v.variance} Resolved
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right hidden md:table-cell text-sm">
        R{Math.abs(v.varianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-sm"></TableCell>
      <TableCell className="text-sm">
        {isUnknown && !v.isApprovedSerial && (
          <div className="space-y-1">
            {v.serialVerificationStatus === "completed" && v.serialVerificationResult ? (
              <Badge className={`text-xs ${v.serialVerificationResult === "confirmed" ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}`}>
                {v.serialVerificationResult === "confirmed" ? "Confirmed Present" : "Not Found"}
              </Badge>
            ) : v.serialVerificationStatus === "pending" ? (
              <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
                Verifying — {v.serialVerificationTeamName}
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
                Unknown Serial
              </Badge>
            )}
            <div className="flex items-center gap-1">
              {onApproveUnknownSerial && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                    onClick={() => onEditUnknownSerial?.(v)}
                    disabled={isSaving || v.serialVerificationStatus === "pending"}
                    title="Edit serial number"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  {v.serialVerificationStatus !== "pending" && onSerialVerify && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-1.5 text-purple-700 border-purple-300 hover:bg-purple-50"
                      onClick={() => onSerialVerify(v)}
                      disabled={isSaving}
                      title={v.serialVerificationStatus === "completed" ? "Re-assign verification" : "Assign verification"}
                    >
                      <ClipboardCheck className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => onApproveUnknownSerial(v)}
                    disabled={isSaving || v.serialVerificationStatus === "pending"}
                    title="Approve serial"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-red-700 border-red-300 hover:bg-red-50"
                    onClick={() => onDismissUnknownSerial?.(v)}
                    disabled={isSaving || v.serialVerificationStatus === "pending"}
                    title="Dismiss serial"
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {v.isApprovedSerial && (
          <div className="space-y-1">
            <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
              Approved Serial
            </Badge>
            {onEditUnknownSerial && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={() => onEditUnknownSerial(v)}
                  disabled={isSaving}
                  title="Edit serial number"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
        {!isUnknown && !v.isApprovedSerial && !hasVerification && (
          <span className="text-muted-foreground">—</span>
        )}
        {!isUnknown && !v.isApprovedSerial && isVerificationPending && (
          <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
            Pending — {v.verificationTeamName}
          </Badge>
        )}
        {!isUnknown && !v.isApprovedSerial && isVerificationCompleted && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs whitespace-nowrap">
                Verified: {v.verificationQty}
              </Badge>
              <span className="text-xs text-muted-foreground">
                by {v.verificationTeamName}
              </span>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => onAccept?.("accept_original", v)}
                disabled={isSaving}
              >
                Keep Original
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onAccept?.("accept_verification", v)}
                disabled={isSaving}
              >
                Accept Verified
              </Button>
            </div>
          </div>
        )}
        {!isUnknown && !v.isApprovedSerial && isVerificationAccepted && (
          <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
            Verification Resolved
          </Badge>
        )}
      </TableCell>
      {showEditButton && (
        <TableCell>
          {!isUnknown && !v.isApprovedSerial && (
            <div className="flex items-center gap-1">
              {showAcceptButton && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2 text-green-700 border-green-300 hover:bg-green-50"
                  onClick={() => onAcceptVariance?.(v)}
                  disabled={isSaving}
                  title="Accept variance"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
              {showReopenButton && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                  onClick={() => onReopenVariance?.(v)}
                  disabled={isSaving}
                  title="Reopen variance"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onEdit?.(v)}
              >
                Edit
              </Button>
            </div>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
