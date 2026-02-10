"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Upload, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

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
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events || []);
      // Auto-select first setup event
      const setupEvent = data.events?.find(
        (e: EventOption) => e.status === "setup"
      );
      if (setupEvent) setSelectedEventId(String(setupEvent.id));
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleUpload = async () => {
    if (!file || !selectedEventId) {
      toast.error("Please select a file and event");
      return;
    }

    setUploading(true);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("eventId", selectedEventId);

      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSummary(data.summary);
        toast.success(
          `Imported ${data.summary.totalItems} items successfully!`
        );
      } else {
        toast.error(data.error || "Import failed");
        if (data.unmappedHeaders) {
          console.log("Unmapped headers:", data.unmappedHeaders);
        }
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Import Data</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload NetSuite Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Event selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Event</label>
            <Select
              value={selectedEventId}
              onValueChange={setSelectedEventId}
            >
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Choose event..." />
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

          <Button
            onClick={handleUpload}
            disabled={uploading || !file || !selectedEventId}
            className="w-full h-12"
          >
            {uploading ? "Importing..." : "Import Data"}
          </Button>
        </CardContent>
      </Card>

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
