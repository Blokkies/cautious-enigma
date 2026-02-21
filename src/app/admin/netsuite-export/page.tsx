"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

interface EventInfo {
  id: number;
  name: string;
  status: string;
  startDate: string | null;
}

const VARIANCE_TYPES = [
  "variances_nonserialized_up",
  "variances_nonserialized_down",
  "variances_serialized_up",
  "variances_serialized_down",
] as const;

const VARIANCE_FILENAMES: Record<string, string> = {
  variances_nonserialized_up: "nonserialized_variances_up.xlsx",
  variances_nonserialized_down: "nonserialized_variances_down.xlsx",
  variances_serialized_up: "serialized_variances_up.xlsx",
  variances_serialized_down: "serialized_variances_down.xlsx",
};

const statusColors: Record<string, string> = {
  setup: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  locked: "bg-gray-100 text-gray-800",
};

function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim();
}

export default function NetSuiteExportPage() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressValue, setProgressValue] = useState(0);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch("/api/admin/events");
        if (!res.ok) throw new Error("Failed to fetch events");
        const data = await res.json();
        setEvents(data.events || []);
      } catch {
        toast.error("Failed to load events");
      } finally {
        setLoading(false);
      }
    }
    fetchEvents();
  }, []);

  const allSelected = events.length > 0 && selected.size === events.length;

  function toggleEvent(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(events.map((e) => e.id)));
    }
  }

  async function handleGenerate() {
    const selectedEvents = events.filter((e) => selected.has(e.id));
    if (selectedEvents.length === 0) return;

    setGenerating(true);
    setProgressValue(0);
    setProgressText("Starting export...");

    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let fileCount = 0;
      const totalFetches = selectedEvents.length * VARIANCE_TYPES.length;
      let completedFetches = 0;

      for (const event of selectedEvents) {
        setProgressText(
          `Fetching ${event.name} (${selectedEvents.indexOf(event) + 1}/${selectedEvents.length})...`
        );
        const folderName = sanitizeFolderName(event.name);

        const results = await Promise.all(
          VARIANCE_TYPES.map(async (type) => {
            const params = new URLSearchParams({
              type,
              format: "xlsx",
              eventId: String(event.id),
            });
            try {
              const res = await fetch(`/api/supervisor/export?${params}`);
              if (!res.ok) return null;
              const blob = await res.blob();
              return { filename: VARIANCE_FILENAMES[type], blob };
            } catch {
              return null;
            } finally {
              completedFetches++;
              setProgressValue(Math.round((completedFetches / totalFetches) * 100));
            }
          })
        );

        for (const result of results) {
          if (result) {
            zip.file(`${folderName}/${result.filename}`, result.blob);
            fileCount++;
          }
        }
      }

      if (fileCount === 0) {
        toast.error("No variance data found for the selected events");
        return;
      }

      setProgressText("Generating ZIP file...");
      const zipBlob = await zip.generateAsync({ type: "blob" });

      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `netsuite_export_${today}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Export complete — ${fileCount} files in ZIP`);
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setGenerating(false);
      setProgressText("");
      setProgressValue(0);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">NetSuite Export</h1>
        <Button
          onClick={handleGenerate}
          disabled={selected.size === 0 || generating}
          className="gap-2"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Generate Export
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Select events to include in the NetSuite variance export. Each event produces up to 4
        variance files (nonserialized up/down, serialized up/down) organized in folders.
      </p>

      {generating && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="text-sm font-medium">{progressText}</div>
            <Progress value={progressValue} />
          </CardContent>
        </Card>
      )}

      {events.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No events found</p>
            <p className="text-sm mt-1">Create events in the Events tab first.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              id="select-all"
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={generating}
            />
            <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
              {allSelected ? "Deselect All" : "Select All"}
            </label>
            {selected.size > 0 && (
              <span className="text-sm text-muted-foreground">
                ({selected.size} selected)
              </span>
            )}
          </div>

          <div className="space-y-2">
            {events.map((event) => (
              <Card
                key={event.id}
                className={`cursor-pointer transition-colors ${
                  selected.has(event.id) ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => !generating && toggleEvent(event.id)}
              >
                <CardContent className="py-3 flex items-center gap-3">
                  <Checkbox
                    checked={selected.has(event.id)}
                    onCheckedChange={() => toggleEvent(event.id)}
                    disabled={generating}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{event.name}</div>
                    {event.startDate && (
                      <div className="text-xs text-muted-foreground">{event.startDate}</div>
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className={statusColors[event.status] || ""}
                  >
                    {event.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
