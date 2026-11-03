"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Download, FileOutput, FileSpreadsheet, Loader2, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { adminRoutes } from "@/lib/admin-routes";
import { formatDateRange, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { ListSkeleton } from "@/components/admin/loading-state";
import { classifyExportResponse, uniqueFolderNames } from "@/components/netsuite/zip-helpers";

interface EventInfo {
  id: number;
  name: string;
  location: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
}

const VARIANCE_TYPES = [
  "variances_nonserialized_up",
  "variances_nonserialized_down",
  "variances_serialized_up",
  "variances_serialized_down",
] as const;

/** What each NetSuite file holds, in the order the ZIP lists them. */
const NETSUITE_FILES: { type: (typeof VARIANCE_TYPES)[number]; title: string; icon: typeof ArrowUp; tone: string; body: string }[] = [
  {
    type: "variances_nonserialized_up",
    title: "Non-serialized, up",
    icon: ArrowUp,
    tone: "text-amber-600",
    body: "Ordinary items where more was counted than NetSuite had on hand. One row per item per bin with the counted quantity, variance and value. Use it to adjust stock up.",
  },
  {
    type: "variances_nonserialized_down",
    title: "Non-serialized, down",
    icon: ArrowDown,
    tone: "text-red-600",
    body: "Ordinary items where less was counted than expected (shortages). Use it to adjust stock down.",
  },
  {
    type: "variances_serialized_up",
    title: "Serialized, up",
    icon: ScanBarcode,
    tone: "text-amber-600",
    body: "Serial numbers that were found but not expected in that bin: accepted serialized over-counts plus the approved serials of resolved serial discrepancies. One row per serial.",
  },
  {
    type: "variances_serialized_down",
    title: "Serialized, down",
    icon: ScanBarcode,
    tone: "text-red-600",
    body: "Expected serial numbers that were not found. One row per missing serial. Use it to remove those serials from stock.",
  },
];

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

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default function ExportsPage() {
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressValue, setProgressValue] = useState(0);
  // Unreviewed variances per event: the NetSuite files only carry accepted
  // counts and approved serials of resolved discrepancies.
  const [unreviewed, setUnreviewed] = useState<Record<number, UnreviewedInfo>>({});
  const requestedUnreviewed = useRef<Set<number>>(new Set());

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
      const list: EventInfo[] = data?.events ?? [];
      // Finished events first (they are the ones to export), newest first.
      const rank = (s: string) => (s === "completed" ? 0 : s === "locked" ? 1 : s === "active" ? 2 : 3);
      setEvents([...list].sort((a, b) => rank(a.status) - rank(b.status) || b.id - a.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void loadEvents();
  }, [loadEvents]);

  const retry = () => {
    setLoading(true);
    loadEvents();
  };

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
        .catch(() => {
          /* warning is best-effort */
        });
    }
  }, [selected]);

  const list = events ?? [];
  // Setup events have no counts, so there is nothing to export.
  const exportable = list.filter((e) => e.status !== "setup");
  const selectedUnreviewed = list
    .filter((e) => selected.has(e.id) && (unreviewed[e.id]?.total ?? 0) > 0)
    .map((e) => ({ event: e, info: unreviewed[e.id]! }));
  const totalUnreviewed = selectedUnreviewed.reduce((sum, u) => sum + u.info.total, 0);
  const allSelected = exportable.length > 0 && exportable.every((e) => selected.has(e.id));

  function toggleEvent(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(exportable.map((e) => e.id)));
  }

  async function handleGenerate() {
    const selectedEvents = list.filter((e) => selected.has(e.id));
    if (selectedEvents.length === 0) return;

    setGenerating(true);
    setProgressValue(0);
    setProgressText("Starting export…");

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

      for (const [index, event] of selectedEvents.entries()) {
        setProgressText(`Fetching ${event.name} (${index + 1} of ${selectedEvents.length})…`);
        const folderName = folderNames.get(event.id)!;

        const results = await Promise.all(
          VARIANCE_TYPES.map(async (type) => {
            const params = new URLSearchParams({ type, format: "xlsx", eventId: String(event.id) });
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
              const filename = extractFilename(res.headers.get("Content-Disposition"), `${type}.xlsx`);
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
          `Export stopped: ${failures.length} file${failures.length === 1 ? "" : "s"} failed to download (${shown}${more}). No ZIP was created. Try again.`,
          { duration: 15000 }
        );
        return;
      }

      if (fileCount === 0) {
        toast.error("The selected events have no accepted variances, so there is nothing to export.");
        return;
      }

      setProgressText("Building the ZIP…");
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

      toast.success(`NetSuite ZIP downloaded with ${fileCount} file${fileCount === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setGenerating(false);
      setProgressText("");
      setProgressValue(0);
    }
  }

  return (
    <>
      <PageHeader
        title="Exports"
        description="Build the NetSuite adjustment files for one or more stocktakes in a single ZIP. Every other report is on each event's Exports tab."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* Builder */}
        <section className="min-w-0 space-y-4" aria-labelledby="netsuite-zip">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <h2 id="netsuite-zip" className="text-base font-semibold text-slate-900">NetSuite ZIP</h2>
                <p className="text-sm text-slate-600">Tick the stocktakes to include. Each gets its own folder with up to four files.</p>
              </div>
              <Button onClick={handleGenerate} disabled={selected.size === 0 || generating} className="shrink-0">
                {generating ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Download />}
                {selected.size > 0 ? `Download ZIP (${selected.size})` : "Download ZIP"}
              </Button>
            </div>

            {generating && (
              <div className="space-y-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5" role="status">
                <div className="text-sm text-slate-700">{progressText}</div>
                <Progress value={progressValue} className="h-1.5 bg-slate-200" />
              </div>
            )}

            {events === null ? (
              loadError ? (
                <ErrorState className="m-4 border-0" title="Could not load events" message={loadError} onRetry={retry} retrying={loading} />
              ) : (
                <ListSkeleton rows={4} className="rounded-none border-0" />
              )
            ) : list.length === 0 ? (
              <EmptyState
                className="m-4"
                icon={FileSpreadsheet}
                title="No stocktakes yet"
                description="Exports become available once a stocktake has gone live and teams have counted."
                action={
                  <Button asChild variant="outline">
                    <Link href={adminRoutes.newEvent}>New stocktake</Link>
                  </Button>
                }
              />
            ) : (
              <>
                {exportable.length > 0 && (
                  <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 sm:px-5">
                    <Checkbox id="select-all" checked={allSelected} onCheckedChange={toggleAll} disabled={generating} />
                    <label htmlFor="select-all" className="cursor-pointer text-sm text-slate-700">
                      Select all
                    </label>
                    {selected.size > 0 && <span className="text-xs text-slate-500">{selected.size} selected</span>}
                  </div>
                )}
                <ul className="divide-y divide-slate-100">
                  {list.map((event) => {
                    const isSetup = event.status === "setup";
                    const checked = selected.has(event.id);
                    const pending = unreviewed[event.id]?.total ?? 0;
                    const dates = formatDateRange(event.startDate, event.endDate);
                    const boxId = `event-${event.id}`;
                    return (
                      <li key={event.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", checked && "bg-primary/[0.03]")}>
                        <Checkbox
                          id={boxId}
                          checked={checked}
                          onCheckedChange={() => toggleEvent(event.id)}
                          disabled={generating || isSetup}
                          aria-describedby={isSetup ? `${boxId}-why` : undefined}
                        />
                        <label htmlFor={boxId} className={cn("min-w-0 flex-1", isSetup ? "cursor-default" : "cursor-pointer")}>
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">{event.name}</span>
                            <StatusBadge status={event.status} size="sm" />
                            {checked && pending > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                {formatNumber(pending)} unreviewed
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-slate-500" id={isSetup ? `${boxId}-why` : undefined}>
                            {isSetup ? "Still in setup, nothing counted yet" : [event.location, dates].filter(Boolean).join(", ") || "No location or dates"}
                          </span>
                        </label>
                        <Link
                          href={adminRoutes.event(event.id, "exports")}
                          aria-label={`All reports for ${event.name}`}
                          className="inline-flex shrink-0 items-center gap-1 rounded p-1 text-xs font-medium text-primary hover:underline"
                        >
                          <FileOutput className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                          <span className="hidden sm:inline">All reports</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {totalUnreviewed > 0 && (
            <div role="alert" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="font-medium">
                  {plural(totalUnreviewed, "unreviewed variance", "unreviewed variances")} will be left out of the ZIP
                </p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {selectedUnreviewed.map(({ event, info }) => (
                    <li key={event.id}>
                      {event.name}: {plural(info.unreviewedCounts, "count not yet accepted", "counts not yet accepted")}
                      {info.unreviewedSerials > 0 && `, ${plural(info.unreviewedSerials, "serial", "serials")} in open serial discrepancies`}
                    </li>
                  ))}
                </ul>
                <p>
                  The NetSuite files only carry reviewed results. Ask a supervisor to accept or recount these on the Variances page,
                  then download again.
                </p>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Need the master export, all variances, serial numbers, queries, breakdowns or the audit log? Open{" "}
            <span className="font-medium text-slate-700">All reports</span> next to an event, or use its Exports tab.
          </p>
        </section>

        {/* Explanation */}
        <aside className="space-y-4 lg:sticky lg:top-8">
          <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-slate-900">The four NetSuite files</h2>
            <p className="mt-1 text-sm text-slate-600">
              &ldquo;Up&rdquo; means more was counted than NetSuite expected; &ldquo;down&rdquo; means less. A file is left out when an
              event has nothing of that kind.
            </p>
            <ul className="mt-4 space-y-4">
              {NETSUITE_FILES.map((f) => (
                <li key={f.type} className="flex gap-3">
                  <f.icon className={cn("mt-0.5 h-4 w-4 shrink-0", f.tone)} aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-medium text-slate-900">{f.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{f.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 sm:p-5">
            <h2 className="text-sm font-semibold text-slate-900">When to export</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4">
              <li>Mark the stocktake complete so counts stop changing.</li>
              <li>Make sure supervisors have accepted every variance and resolved every serial discrepancy. Anything unreviewed is left out.</li>
              <li>Download the ZIP and post the adjustments in NetSuite.</li>
              <li>Lock the stocktake to archive it.</li>
            </ol>
            <p className="mt-3 text-xs text-slate-500">
              Every file includes the item and bin internal IDs, warehouse, serial number, on hand, counted quantity, variance and
              value. <Link href={adminRoutes.help("closing-exporting")} className="font-medium text-primary hover:underline">Read more in the guide</Link>.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
