"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Plus,
  X,
  Pencil,
  ToggleLeft,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

interface ExpectedSerial {
  itemId: number;
  serialNumber: string | null;
  status: "found" | "not_found" | "uncounted";
}

interface DiscrepancyItem {
  id: number;
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  unknownSerials: string[];
  expectedSerials: ExpectedSerial[];
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  teamName: string;
  teamId: number;
}

export default function SupervisorSerialReviewPage() {
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadDiscrepancies = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/serial-review");
      if (res.ok) {
        const data = await res.json();
        setDiscrepancies(data.discrepancies || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiscrepancies();
    const interval = setInterval(loadDiscrepancies, 10000);
    return () => clearInterval(interval);
  }, [loadDiscrepancies]);

  const handleResolve = async (discrepancyId: number) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/supervisor/serial-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discrepancyId,
          action: "resolve",
          resolution: resolutionText,
        }),
      });
      if (res.ok) {
        toast.success("Discrepancy resolved");
        setResolvingId(null);
        setResolutionText("");
        loadDiscrepancies();
      }
    } catch {
      toast.error("Failed to resolve discrepancy");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateUnknowns = async (
    discrepancyId: number,
    unknownSerials: string[]
  ) => {
    try {
      const res = await fetch("/api/supervisor/serial-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discrepancyId,
          action: "update-unknowns",
          unknownSerials,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to update serials");
      }
    } catch {
      toast.error("Failed to update serials");
    }
  };

  const handleOverrideExpected = async (
    discrepancyId: number,
    itemId: number,
    newStatus: "found" | "not_found"
  ) => {
    // Optimistic update
    setDiscrepancies((prev) =>
      prev.map((d) =>
        d.id === discrepancyId
          ? {
              ...d,
              expectedSerials: d.expectedSerials.map((s) =>
                s.itemId === itemId ? { ...s, status: newStatus } : s
              ),
            }
          : d
      )
    );

    try {
      const res = await fetch("/api/supervisor/serial-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discrepancyId,
          action: "override-expected",
          itemId,
          newStatus,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to update status");
        loadDiscrepancies(); // revert optimistic
      } else {
        toast.success(`Serial marked as ${newStatus === "found" ? "Found" : "Not Found"}`);
      }
    } catch {
      toast.error("Failed to update status");
      loadDiscrepancies();
    }
  };

  const handleReopen = async (discrepancyId: number) => {
    try {
      const res = await fetch("/api/supervisor/serial-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discrepancyId,
          action: "reopen",
        }),
      });
      if (res.ok) {
        toast.success("Discrepancy reopened");
        loadDiscrepancies();
      }
    } catch {
      toast.error("Failed to reopen discrepancy");
    }
  };

  const openDiscrepancies = discrepancies.filter((d) => d.status === "open");
  const resolvedDiscrepancies = discrepancies.filter(
    (d) => d.status === "resolved"
  );

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Serial Review</h1>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">
            Open ({openDiscrepancies.length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolvedDiscrepancies.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="space-y-3 mt-3">
          {openDiscrepancies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No open serial discrepancies
            </div>
          ) : (
            openDiscrepancies.map((d) => (
              <DiscrepancyCard
                key={d.id}
                d={d}
                editable
                resolvingId={resolvingId}
                resolutionText={resolutionText}
                submitting={submitting}
                onSetResolvingId={setResolvingId}
                onSetResolutionText={setResolutionText}
                onResolve={handleResolve}
                onUpdateUnknowns={handleUpdateUnknowns}
                onOverrideExpected={handleOverrideExpected}
              />
            ))
          )}
        </TabsContent>
        <TabsContent value="resolved" className="space-y-3 mt-3">
          {resolvedDiscrepancies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No resolved serial discrepancies
            </div>
          ) : (
            resolvedDiscrepancies.map((d) => (
              <DiscrepancyCard
                key={d.id}
                d={d}
                editable={false}
                onReopen={handleReopen}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Unknown Serial Row ──────────────────────────────────────────────────
function UnknownSerialRow({
  serial,
  onUpdate,
  onRemove,
}: {
  serial: string;
  onUpdate: (newValue: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(serial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== serial) {
      onUpdate(trimmed);
    } else {
      setEditValue(serial);
    }
    setEditing(false);
  };

  return (
    <tr className="bg-amber-50">
      <td className="px-3 py-1.5 font-mono text-xs">
        {editing ? (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") {
                setEditValue(serial);
                setEditing(false);
              }
            }}
            className="h-6 text-xs font-mono px-1 py-0"
          />
        ) : (
          <span
            className="cursor-pointer hover:underline inline-flex items-center gap-1"
            onClick={() => setEditing(true)}
          >
            {serial}
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-amber-700">
            <AlertTriangle className="h-3 w-3" /> Unknown
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
            onClick={onRemove}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Expected Serial Row ─────────────────────────────────────────────────
function ExpectedSerialRow({
  serial,
  editable,
  onToggle,
}: {
  serial: ExpectedSerial;
  editable: boolean;
  onToggle: (itemId: number, newStatus: "found" | "not_found") => void;
}) {
  const bgClass =
    serial.status === "found"
      ? "bg-green-50"
      : serial.status === "not_found"
        ? "bg-red-50"
        : "";

  const toggleStatus = () => {
    if (!editable) return;
    const newStatus = serial.status === "found" ? "not_found" : "found";
    onToggle(serial.itemId, newStatus);
  };

  return (
    <tr className={bgClass}>
      <td className="px-3 py-1.5 font-mono text-xs">
        {serial.serialNumber || "—"}
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="inline-flex items-center gap-2">
          {serial.status === "found" && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="h-3 w-3" /> Found
            </span>
          )}
          {serial.status === "not_found" && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700">
              <XCircle className="h-3 w-3" /> Not Found
            </span>
          )}
          {serial.status === "uncounted" && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" /> Uncounted
            </span>
          )}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={toggleStatus}
              title={
                serial.status === "found"
                  ? "Mark as Not Found"
                  : "Mark as Found"
              }
            >
              <ToggleLeft className="h-3 w-3" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Discrepancy Card ────────────────────────────────────────────────────
function DiscrepancyCard({
  d,
  editable,
  resolvingId,
  resolutionText,
  submitting,
  onSetResolvingId,
  onSetResolutionText,
  onResolve,
  onReopen,
  onUpdateUnknowns,
  onOverrideExpected,
}: {
  d: DiscrepancyItem;
  editable: boolean;
  resolvingId?: number | null;
  resolutionText?: string;
  submitting?: boolean;
  onSetResolvingId?: (id: number | null) => void;
  onSetResolutionText?: (text: string) => void;
  onResolve?: (id: number) => void;
  onReopen?: (id: number) => void;
  onUpdateUnknowns?: (id: number, serials: string[]) => void;
  onOverrideExpected?: (
    discrepancyId: number,
    itemId: number,
    newStatus: "found" | "not_found"
  ) => void;
}) {
  const [localUnknowns, setLocalUnknowns] = useState(d.unknownSerials);
  const [addingNew, setAddingNew] = useState(false);
  const [newSerial, setNewSerial] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  // Sync local state when data refreshes
  useEffect(() => {
    setLocalUnknowns(d.unknownSerials);
  }, [d.unknownSerials]);

  useEffect(() => {
    if (addingNew && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [addingNew]);

  const removeUnknown = (index: number) => {
    const updated = localUnknowns.filter((_, i) => i !== index);
    setLocalUnknowns(updated);
    onUpdateUnknowns?.(d.id, updated);
  };

  const updateUnknown = (index: number, newValue: string) => {
    const updated = localUnknowns.map((s, i) => (i === index ? newValue : s));
    setLocalUnknowns(updated);
    onUpdateUnknowns?.(d.id, updated);
  };

  const addUnknown = () => {
    const trimmed = newSerial.trim();
    if (!trimmed) return;
    const updated = [...localUnknowns, trimmed];
    setLocalUnknowns(updated);
    setNewSerial("");
    setAddingNew(false);
    onUpdateUnknowns?.(d.id, updated);
  };

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-medium">
              {d.teamName}
            </Badge>
            <span className="font-mono font-semibold text-sm">
              {d.itemCode}
            </span>
            {d.binNumber && (
              <Badge variant="secondary" className="text-xs">
                {d.binNumber}
              </Badge>
            )}
          </div>
          <Badge
            className={
              d.status === "resolved"
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }
          >
            {d.status === "resolved" ? (
              <CheckCircle2 className="h-3 w-3 mr-1" />
            ) : (
              <Clock className="h-3 w-3 mr-1" />
            )}
            {d.status}
          </Badge>
        </div>

        {/* Description */}
        {d.description && (
          <p className="text-sm text-muted-foreground mb-3">{d.description}</p>
        )}

        {/* Serial status table */}
        <div className="border rounded-lg overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Serial Number
                </th>
                <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground text-right">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Expected serials */}
              {d.expectedSerials.map((s) => (
                <ExpectedSerialRow
                  key={`expected-${s.itemId}`}
                  serial={s}
                  editable={editable}
                  onToggle={(itemId, newStatus) =>
                    onOverrideExpected?.(d.id, itemId, newStatus)
                  }
                />
              ))}

              {/* Unknown serials */}
              {editable
                ? localUnknowns.map((serial, i) => (
                    <UnknownSerialRow
                      key={`unknown-${i}`}
                      serial={serial}
                      onUpdate={(newValue) => updateUnknown(i, newValue)}
                      onRemove={() => removeUnknown(i)}
                    />
                  ))
                : d.unknownSerials.map((serial, i) => (
                    <tr key={`unknown-${i}`} className="bg-amber-50">
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {serial}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle className="h-3 w-3" /> Unknown
                        </span>
                      </td>
                    </tr>
                  ))}

              {/* Add new unknown row */}
              {editable && addingNew && (
                <tr className="bg-amber-50/50">
                  <td className="px-3 py-1.5" colSpan={2}>
                    <div className="flex gap-2">
                      <Input
                        ref={newInputRef}
                        value={newSerial}
                        onChange={(e) => setNewSerial(e.target.value)}
                        placeholder="Enter serial number..."
                        className="h-6 text-xs font-mono px-1 py-0 flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addUnknown();
                          if (e.key === "Escape") {
                            setAddingNew(false);
                            setNewSerial("");
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={addUnknown}
                        disabled={!newSerial.trim()}
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-2"
                        onClick={() => {
                          setAddingNew(false);
                          setNewSerial("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Add serial button */}
          {editable && !addingNew && (
            <button
              className="w-full py-1.5 text-xs text-amber-700 hover:bg-amber-50 flex items-center justify-center gap-1 border-t"
              onClick={() => setAddingNew(true)}
            >
              <Plus className="h-3 w-3" /> Add unknown serial
            </button>
          )}
        </div>

        <div className="text-xs text-muted-foreground mb-2">
          {new Date(d.createdAt).toLocaleString()}
        </div>

        {/* Open: resolution form */}
        {d.status === "open" && onResolve && (
          <>
            {resolvingId === d.id ? (
              <div className="space-y-2">
                <Textarea
                  value={resolutionText || ""}
                  onChange={(e) => onSetResolutionText?.(e.target.value)}
                  placeholder="Enter resolution notes..."
                  rows={3}
                  dir="ltr"
                  className="text-left"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => onResolve(d.id)}
                    disabled={submitting}
                    size="sm"
                    className="gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {submitting ? "Resolving..." : "Resolve"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onSetResolvingId?.(null);
                      onSetResolutionText?.("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-green-300 text-green-700 hover:bg-green-50"
                onClick={() => onSetResolvingId?.(d.id)}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Resolve
              </Button>
            )}
          </>
        )}

        {/* Resolved: show resolution + reopen */}
        {d.status === "resolved" && (
          <div className="space-y-2">
            {d.resolution && (
              <div className="bg-green-50 p-3 rounded text-sm text-green-900 border border-green-200">
                <span className="font-semibold">Resolution:</span> {d.resolution}
                {d.resolvedAt && (
                  <div className="text-xs text-green-700 mt-1">
                    Resolved {new Date(d.resolvedAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}
            {onReopen && (
              <Button
                variant="outline"
                size="sm"
                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => onReopen(d.id)}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reopen
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
