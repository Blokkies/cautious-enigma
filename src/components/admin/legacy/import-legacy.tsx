"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, FileSpreadsheet, CheckCircle2, ArrowLeft, Loader2, Copy, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface ImportSummary {
  totalItems: number;
  uniqueBins: number;
  uniqueBrands: number;
  totalValue: number;
  mappedFields: string[];
  unmappedHeaders: string[];
}

/**
 * The upload (POST) and copy-from-event (PUT) responses don't necessarily carry the
 * same fields (a copy has no column mapping), so fill every field with a safe default.
 */
function normalizeSummary(raw: Partial<ImportSummary> | null | undefined): ImportSummary {
  return {
    totalItems: Number(raw?.totalItems) || 0,
    uniqueBins: Number(raw?.uniqueBins) || 0,
    uniqueBrands: Number(raw?.uniqueBrands) || 0,
    totalValue: Number(raw?.totalValue) || 0,
    mappedFields: Array.isArray(raw?.mappedFields) ? raw.mappedFields : [],
    unmappedHeaders: Array.isArray(raw?.unmappedHeaders) ? raw.unmappedHeaders : [],
  };
}

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface EventOption {
  id: number;
  name: string;
  status: string;
}

/** Interim (pre-redesign) screen, pinned to `eventId`. Phase 2 replaces it. */
export function ImportPageContent({ eventId: urlEventId }: { eventId?: string } = {}) {

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(urlEventId || "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [existingEvents, setExistingEvents] = useState<{ id: number; name: string; status: string; itemCount: number }[]>([]);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [copying, setCopying] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const processingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Confirmation dialog (re-import over existing items, or deleting recorded counts)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const startProcessingProgress = useCallback(() => {
    setProcessingProgress(0);
    processingIntervalRef.current = setInterval(() => {
      setProcessingProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 8 + 2;
      });
    }, 500);
  }, []);

  const stopProcessingProgress = useCallback(() => {
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
    setProcessingProgress(100);
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        // Only auto-select if no URL param provided
        if (!urlEventId) {
          const setupEvent = data.events?.find(
            (e: EventOption) => e.status === "setup"
          );
          if (setupEvent) setSelectedEventId(String(setupEvent.id));
        }
      } else {
        toast.error("Failed to load events");
      }
    } catch {
      toast.error("Failed to load events");
    }
  }, [urlEventId]);

  const loadExistingEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/import");
      if (res.ok) {
        const data = await res.json();
        setExistingEvents(data.events || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadEvents();
    loadExistingEvents();
  }, [loadEvents, loadExistingEvents]);

  const selectedEvent = events.find((e) => String(e.id) === selectedEventId);
  // Items already in the selected event (the copy-from list only holds events with items)
  const existingItemCount =
    existingEvents.find((e) => String(e.id) === selectedEventId)?.itemCount ?? 0;

  /** Runs `action` directly, or after confirmation when the event already has items. */
  const confirmReplaceItems = (action: () => void) => {
    if (existingItemCount <= 0) {
      action();
      return;
    }
    setPendingConfirm({
      title: "Replace existing items?",
      message:
        `This event already has ${existingItemCount.toLocaleString()} imported items. ` +
        "Importing replaces all of them: every bin assignment is removed (teams must be assigned again), " +
        "open queries and breakdowns are deleted, and the warehouse selection is reset. " +
        "If counts have already been recorded you will be asked separately before they are deleted.",
      confirmLabel: "Replace Items",
      onConfirm: action,
    });
  };

  const confirmDeleteCounts = (error: string, retry: () => void) => {
    setPendingConfirm({
      title: "Delete recorded counts?",
      message: `${error} Continue and delete existing counts?`,
      confirmLabel: "Delete Counts & Import",
      onConfirm: retry,
    });
  };

  const handleUpload = (confirmed = false) => {
    if (!file || !selectedEventId) {
      toast.error("Please select a file and event");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setSummary(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("eventId", selectedEventId);
    if (confirmed) formData.append("confirm", "true");

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.upload.addEventListener("load", () => {
      setUploadProgress(null);
      startProcessingProgress();
    });
    xhr.addEventListener("load", () => {
      stopProcessingProgress();
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          const result = normalizeSummary(data.summary);
          setSummary(result);
          toast.success(`Imported ${result.totalItems} items successfully!`);
          loadExistingEvents(); // Refresh so copy-from picks up new data
        } else if (xhr.status === 409 && data.requiresConfirm) {
          confirmDeleteCounts(data.error, () => handleUpload(true));
        } else {
          toast.error(data.error || "Import failed");
        }
      } catch {
        toast.error("Import failed");
      }
      setUploading(false);
      setUploadProgress(null);
    });
    xhr.addEventListener("error", () => {
      stopProcessingProgress();
      toast.error("Upload failed");
      setUploading(false);
      setUploadProgress(null);
    });

    xhr.open("POST", "/api/admin/import");
    xhr.send(formData);
  };

  const handleCopyFromEvent = async (confirmed = false) => {
    if (!copySourceId || !selectedEventId) return;
    setCopying(true);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEventId: Number(copySourceId), targetEventId: Number(selectedEventId), confirm: confirmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const result = normalizeSummary(data.summary);
        setSummary(result);
        toast.success(`Copied ${result.totalItems} items`);
        loadExistingEvents(); // Refresh item counts (re-import confirmation, copy-from list)
      } else if (res.status === 409 && data.requiresConfirm) {
        confirmDeleteCounts(data.error, () => handleCopyFromEvent(true));
      } else {
        toast.error(data.error || "Copy failed");
      }
    } catch {
      toast.error("Copy failed");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/events"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Events
        </Link>
        {selectedEvent && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{selectedEvent.name}</span>
          </>
        )}
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Import</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Import Data</h1>
        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select event..." />
          </SelectTrigger>
          <SelectContent>
            {events
              .filter((e) => e.status === "setup")
              .map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload NetSuite Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Excel File</label>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                {file ? (
                  <span className="font-medium text-primary">{file.name}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Click to select Excel file
                  </span>
                )}
              </label>
            </div>
          </div>

          {!uploading && (
            <Button
              onClick={() => confirmReplaceItems(() => handleUpload())}
              disabled={!file || !selectedEventId}
              className="w-full h-12"
            >
              Import Data
            </Button>
          )}

          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {uploadProgress !== null ? "Uploading file..." : "Processing items..."}
                </span>
                <span className="text-muted-foreground">
                  {uploadProgress !== null ? `${uploadProgress}%` : `${Math.round(processingProgress)}%`}
                </span>
              </div>
              <Progress value={uploadProgress ?? processingProgress} className="h-3" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Copy from Existing Event */}
      {existingEvents.filter(e => String(e.id) !== selectedEventId).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5" />
              Copy from Existing Event
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Copy items from a previous event. Each event gets its own independent copy.
            </p>
            <Select value={copySourceId} onValueChange={setCopySourceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an event to copy from..." />
              </SelectTrigger>
              <SelectContent>
                {existingEvents.filter(e => String(e.id) !== selectedEventId).map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name} ({e.itemCount.toLocaleString()} items)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => confirmReplaceItems(() => handleCopyFromEvent())}
              disabled={!copySourceId || !selectedEventId || copying}
              className="w-full h-12 gap-2"
            >
              {copying ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Copying items...</>
              ) : (
                <><Copy className="h-4 w-4" /> Copy Items</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Import Summary */}
      {summary && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-800">
              <CheckCircle2 className="h-5 w-5" />
              Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-2xl font-bold text-green-800">
                  {(summary.totalItems ?? 0).toLocaleString()}
                </div>
                <div className="text-sm text-green-600">Total Items</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-800">
                  {summary.uniqueBins}
                </div>
                <div className="text-sm text-green-600">Unique Bins</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-800">
                  {summary.uniqueBrands}
                </div>
                <div className="text-sm text-green-600">Unique Brands</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-800">
                  R{(summary.totalValue ?? 0).toLocaleString(undefined, {maximumFractionDigits: 0})}
                </div>
                <div className="text-sm text-green-600">Total Value</div>
              </div>
            </div>

            {(summary.mappedFields ?? []).length > 0 && (
              <div className="mb-3">
                <div className="text-sm font-medium mb-1">Mapped Columns:</div>
                <div className="flex flex-wrap gap-1">
                  {(summary.mappedFields ?? []).map((f, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {f}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {(summary.unmappedHeaders ?? []).length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">
                  Unmapped Columns (ignored):
                </div>
                <div className="flex flex-wrap gap-1">
                  {(summary.unmappedHeaders ?? []).map((h, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs text-muted-foreground"
                    >
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!pendingConfirm}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {pendingConfirm?.title}
            </DialogTitle>
          </DialogHeader>
          {selectedEvent && <div className="font-medium">{selectedEvent.name}</div>}
          <p className="text-sm text-muted-foreground">{pendingConfirm?.message}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const action = pendingConfirm?.onConfirm;
                setPendingConfirm(null);
                action?.();
              }}
            >
              {pendingConfirm?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
