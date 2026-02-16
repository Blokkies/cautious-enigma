"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, CheckCircle2, ArrowLeft, Loader2, Copy } from "lucide-react";
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

interface EventOption {
  id: number;
  name: string;
  status: string;
}

export default function ImportPage() {
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(urlEventId || "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [existingEvents, setExistingEvents] = useState<{ id: number; name: string; status: string; itemCount: number }[]>([]);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [copying, setCopying] = useState(false);

  const loadEvents = useCallback(async () => {
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

  const handleUpload = () => {
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

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.upload.addEventListener("load", () => {
      setUploadProgress(null);
    });
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          setSummary(data.summary);
          toast.success(`Imported ${data.summary.totalItems} items successfully!`);
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
      toast.error("Upload failed");
      setUploading(false);
      setUploadProgress(null);
    });

    xhr.open("POST", "/api/admin/import");
    xhr.send(formData);
  };

  const handleCopyFromEvent = async () => {
    if (!copySourceId || !selectedEventId) return;
    setCopying(true);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEventId: Number(copySourceId), targetEventId: Number(selectedEventId) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSummary(data.summary);
        toast.success(`Copied ${data.summary.totalItems} items`);
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
          href="/admin/setup"
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
              onClick={handleUpload}
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
                {uploadProgress !== null && (
                  <span className="text-muted-foreground">{uploadProgress}%</span>
                )}
              </div>
              <Progress value={uploadProgress ?? 100} className={`h-3 ${uploadProgress === null ? "[&>div]:animate-pulse" : ""}`} />
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
              onClick={handleCopyFromEvent}
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
                  {summary.totalItems.toLocaleString()}
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
                  R{summary.totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
                </div>
                <div className="text-sm text-green-600">Total Value</div>
              </div>
            </div>

            {summary.mappedFields.length > 0 && (
              <div className="mb-3">
                <div className="text-sm font-medium mb-1">Mapped Columns:</div>
                <div className="flex flex-wrap gap-1">
                  {summary.mappedFields.map((f, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {f}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {summary.unmappedHeaders.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">
                  Unmapped Columns (ignored):
                </div>
                <div className="flex flex-wrap gap-1">
                  {summary.unmappedHeaders.map((h, i) => (
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
    </div>
  );
}
