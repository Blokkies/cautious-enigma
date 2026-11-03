"use client";

import { PageHeader } from "@/components/admin/page-header";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { classifyExportResponse, uniqueFolderNames } from "@/components/netsuite/zip-helpers";

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

function extractFilename(contentDisposition: string | null, fallback: string): string {
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
    if (match) return match[1];
  }
  return fallback;
}

interface UnreviewedInfo {
  unreviewedCounts: number;
  unreviewedSerials: number;
  total: number;
}

const statusColors: Record<string, string> = {
  setup: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  locked: "bg-gray-100 text-gray-800",
};

export default function NetSuiteExportPage() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressValue, setProgressValue] = useState(0);
  // Unreviewed variances per event: the NetSuite files only carry accepted
  // counts and approved serials of resolved discrepancies.
  const [unreviewed, setUnreviewed] = useState<Record<number, UnreviewedInfo>>({});
  const requestedUnreviewed = useRef<Set<number>>(new Set());

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

  // Fetch the excluded-unreviewed count for each selected event (once).
  useEffect(() => {
    const missing = Array.from(selected).filter((id) => !requestedUnreviewed.current.has(id));
    for (const id of missing) {
      requestedUnreviewed.current.add(id);
      const params = new URLSearchParams({ type: "netsuite_excluded", eventId: String(id) });
      fetch(`/api/supervisor/export?${params}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: UnreviewedInfo | null) => {
          if (data) setUnreviewed((prev) => ({ ...prev, [id]: data }));
        })
        .catch(() => { /* warning is best-effort */ });
    }
  }, [selected]);

  const selectedUnreviewed = events
    .filter((e) => selected.has(e.id) && (unreviewed[e.id]?.total ?? 0) > 0)
    .map((e) => ({ event: e, info: unreviewed[e.id]! }));
  const totalUnreviewed = selectedUnreviewed.reduce((sum, u) => sum + u.info.total, 0);

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
      // Folder per event, unique even when sanitized names collide
      const folderNames = uniqueFolderNames(selectedEvents);
      // Files that could not be fetched (not "no data" — real failures)
      const failures: string[] = [];

      for (const event of selectedEvents) {
        setProgressText(
          `Fetching ${event.name} (${selectedEvents.indexOf(event) + 1}/${selectedEvents.length})...`
        );
        const folderName = folderNames.get(event.id)!;

        const results = await Promise.all(
          VARIANCE_TYPES.map(async (type) => {
            const params = new URLSearchParams({
              type,
              format: "xlsx",
              eventId: String(event.id),
            });
            try {
              const res = await fetch(`/api/supervisor/export?${params}`);
              if (!res.ok) {
                const body = await res.text().catch(() => null);
                // A plain 404 "No data" means the event has no variances of this type
                if (classifyExportResponse(res.status, body) === "empty") return null;
                failures.push(`${event.name}: ${type} (HTTP ${res.status})`);
                return null;
              }
              const blob = await res.blob();
              const filename = extractFilename(
                res.headers.get("Content-Disposition"),
                `${type}.xlsx`
              );
              return { filename, blob };
            } catch {
              failures.push(`${event.name}: ${type} (network error)`);
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

      // Never hand out a silently incomplete ZIP: NetSuite would miss adjustments.
      if (failures.length > 0) {
        const shown = failures.slice(0, 5).join("; ");
        const more = failures.length > 5 ? ` and ${failures.length - 5} more` : "";
        toast.error(
          `Export aborted: ${failures.length} file${failures.length === 1 ? "" : "s"} failed to download (${shown}${more}). Try again.`,
          { duration: 15000 }
        );
        return;
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
      <PageHeader
        className="mb-2"
        title="Exports"
        description="Build the NetSuite import files for one or more stocktakes. Per-event reports are on each event's Exports tab."
        actions={
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
        }
      />

      <p className="text-sm text-muted-foreground">
        Select events to include in the NetSuite variance export. Each event produces up to 4
        variance files (nonserialized up/down, serialized up/down) organized in folders.
        Only reviewed variances are included: accepted counts and approved serials of
        resolved serial discrepancies.
      </p>

      {totalUnreviewed > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 flex gap-3 text-sm text-amber-900">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <div className="font-medium">
                {totalUnreviewed.toLocaleString()} unreviewed variance
                {totalUnreviewed === 1 ? "" : "s"} will be excluded from the export
              </div>
              <ul className="list-disc pl-4">
                {selectedUnreviewed.map(({ event, info }) => (
                  <li key={event.id}>
                    {event.name}: {info.unreviewedCounts.toLocaleString()} pending count
                    {info.unreviewedCounts === 1 ? "" : "s"}
                    {info.unreviewedSerials > 0 &&
                      `, ${info.unreviewedSerials.toLocaleString()} serial${info.unreviewedSerials === 1 ? "" : "s"} in open discrepancies`}
                  </li>
                ))}
              </ul>
              <div>Review them on the supervisor variances page before exporting to include them.</div>
            </div>
          </CardContent>
        </Card>
      )}

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
                  {(unreviewed[event.id]?.total ?? 0) > 0 && selected.has(event.id) && (
                    <Badge variant="outline" className="border-amber-300 text-amber-800 gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {unreviewed[event.id]!.total.toLocaleString()} unreviewed
                    </Badge>
                  )}
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
