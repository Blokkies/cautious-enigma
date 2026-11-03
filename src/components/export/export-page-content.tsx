"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Archive,
  BarChart3,
  CheckCircle2,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ScanBarcode,
  MessageSquare,
  Package,
  ClipboardCheck,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { downloadAllAsZip } from "@/lib/download-all-zip";
import { useAuth } from "@/contexts/auth-context";
import { formatNumber } from "@/lib/format";
import { StatCard } from "@/components/admin/stat-card";
import { LoadingState } from "@/components/admin/loading-state";
import { EmptyState } from "@/components/admin/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ExportStats {
  total: number;
  counted: number;
  matched: number;
  withVariance: number;
  progressPercent: number;
}

interface EventOption {
  id: number;
  name: string;
  status: string;
}

/** Default event for the admin: active first, then the most recent completed/locked. */
function pickDefaultEvent(events: EventOption[]): EventOption | undefined {
  const reportable = events.filter((e) => e.status !== "setup");
  return (
    reportable.find((e) => e.status === "active") ??
    [...reportable].sort((a, b) => b.id - a.id)[0]
  );
}

// Shared by /supervisor/export and the admin event workspace (/admin/events/[id]/exports).
// Supervisors are pinned to their own event; the admin (eventId 0) picks one, defaulting
// to ?eventId=. Passing `eventId` pins the admin view to that event and hides the picker.
export function ExportPageContent({ eventId }: { eventId?: number } = {}) {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.type === "admin";
  const searchParams = useSearchParams();
  const pinned = !!eventId;
  const urlEventId = eventId ?? (Number(searchParams.get("eventId")) || null);

  const [stats, setStats] = useState<ExportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(urlEventId);

  // Admin: load the event list and resolve a default when none was given.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/events");
        if (!res.ok) return;
        const data = await res.json();
        const list: EventOption[] = data.events || [];
        if (cancelled) return;
        setEvents(list);
        setSelectedEventId((cur) => cur ?? pickDefaultEvent(list)?.id ?? null);
      } catch {
        // offline
      } finally {
        if (!cancelled) setEventsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // Query string for the selected event (admin only; supervisors use their token).
  const eventParam = isAdmin && selectedEventId ? `&eventId=${selectedEventId}` : "";
  const adminWaiting = isAdmin && !selectedEventId;

  // Only the latest stats request may update state (switching events quickly must not
  // let a slower response for the previous event overwrite the current one).
  const statsRequestId = useRef(0);

  const loadStats = useCallback(async () => {
    if (authLoading || adminWaiting) return;
    const requestId = ++statsRequestId.current;
    try {
      const res = await fetch(`/api/supervisor/dashboard${eventParam ? `?${eventParam.slice(1)}` : ""}`);
      if (requestId !== statsRequestId.current) return;
      if (res.ok) {
        const data = await res.json();
        if (requestId !== statsRequestId.current) return;
        setStats({
          total: data.overall.total,
          counted: data.overall.counted,
          matched: data.overall.matched,
          withVariance: data.overall.withVariance,
          progressPercent: data.overall.progressPercent,
        });
      }
    } catch {
      // offline
    } finally {
      if (requestId === statsRequestId.current) setLoading(false);
    }
  }, [authLoading, adminWaiting, eventParam]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleDownload = async (type: string, format: string) => {
    try {
      const res = await fetch(
        `/api/supervisor/export?type=${type}&format=${format}${eventParam}`
      );
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("No data for this export");
          return;
        }
        toast.error("Export failed");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Prefer server-provided filename from Content-Disposition
      const cd = res.headers.get("Content-Disposition");
      const cdMatch = cd?.match(/filename="?([^";\n]+)"?/);
      a.download = cdMatch?.[1] ?? (format === "csv" ? `stocktake_${type}.csv` : `stocktake_${type}.xlsx`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Download started");
    } catch {
      toast.error("Download failed");
    }
  };

  const handleDownloadAll = async () => {
    setZipping(true);
    setZipProgress("Fetching exports...");
    try {
      const eventId = isAdmin && selectedEventId ? selectedEventId : undefined;
      await downloadAllAsZip(eventId, "stocktake_all_exports.zip", (done, total) => {
        setZipProgress(`Fetching exports... ${done}/${total}`);
      });
      toast.success("ZIP download started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ZIP download failed");
    } finally {
      setZipping(false);
      setZipProgress("");
    }
  };
  if (isAdmin && eventsLoaded && !selectedEventId) {
    return (
      <EmptyState
        icon={FileDown}
        title="Nothing to export"
        description="There is no live or completed stocktake to export yet."
      />
    );
  }

  if (loading) {
    return <LoadingState label="Loading exports…" />;
  }

  // In the admin workspace this sits under the event's own h1, so headings drop a level.
  const SectionHeading = pinned ? "h3" : "h2";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {pinned ? (
            <h2 className="text-base font-semibold text-slate-900">Export files</h2>
          ) : (
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Export data</h1>
          )}
          {isAdmin && !pinned && events.length > 0 && (
            <Select
              value={selectedEventId ? String(selectedEventId) : undefined}
              onValueChange={(v) => {
                setLoading(true);
                setStats(null); // don't show the previous event's numbers
                setSelectedEventId(Number(v));
              }}
            >
              <SelectTrigger className="w-full bg-white sm:w-56" aria-label="Select event">
                <SelectValue placeholder="Select event..." />
              </SelectTrigger>
              <SelectContent>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={String(ev.id)}>
                    {ev.name} ({ev.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <p className="max-w-3xl text-sm text-slate-600">
          The four up/down variance files are NetSuite adjustment files: they only include
          accepted counts and approved serials of resolved serial discrepancies. The All
          Variances export lists every variance with its review status.
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total items" value={formatNumber(stats.total)} icon={Package} />
          <StatCard label="Completed" value={`${stats.progressPercent}%`} hint={`${formatNumber(stats.counted)} counted`} icon={BarChart3} />
          <StatCard label="Matched" value={formatNumber(stats.matched)} icon={CheckCircle2} tone="positive" />
          <StatCard
            label="Variances"
            value={formatNumber(stats.withVariance)}
            icon={AlertTriangle}
            tone={stats.withVariance > 0 ? "warning" : "default"}
          />
        </div>
      )}

      {/* Download all as ZIP */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <Archive className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">Everything in one ZIP</div>
            <p className="text-sm text-slate-600">Every export below, in Excel and CSV, bundled into a single download.</p>
          </div>
        </div>
        <Button className="w-full shrink-0 sm:w-auto" onClick={handleDownloadAll} disabled={zipping}>
          {zipping ? (
            <>
              <Loader2 className="animate-spin" />
              {zipProgress}
            </>
          ) : (
            <>
              <Archive />
              Download all (ZIP)
            </>
          )}
        </Button>
      </div>

      <ExportGroup heading="Reports" as={SectionHeading}>
        <ExportRow
          icon={Download}
          title="Master export"
          description="All items with count results, variances, team assignments, comments, check status, count type, and serialized flag. Includes unknown and approved serials."
          type="full"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={AlertTriangle}
          title="All variances"
          description="All items with discrepancies — serialized and non-serialized, up and down. Includes check status and count type."
          type="variances_all"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={ScanBarcode}
          title="Serial number report"
          description="Complete serial number audit — every expected serial with found/not-found status, plus all unknown and approved serials. Includes full item metadata, verification results, and discrepancy resolution details."
          type="serials"
          onDownload={handleDownload}
        />
      </ExportGroup>

      <ExportGroup heading="NetSuite variance files" as={SectionHeading}>
        <ExportRow
          icon={TrendingUp}
          title="Non-serialized variances up"
          description="Non-serialized items where counted quantity exceeds on-hand (surplus, accepted only)."
          type="variances_nonserialized_up"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={TrendingDown}
          title="Non-serialized variances down"
          description="Non-serialized items where counted quantity is less than on-hand (shortage, accepted only)."
          type="variances_nonserialized_down"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={ScanBarcode}
          title="Serialized variances up"
          description="Accepted serialized over-counts plus approved serials from resolved discrepancies."
          type="variances_serialized_up"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={ScanBarcode}
          title="Serialized variances down"
          description="Expected serialized items that were not found during the count (accepted only)."
          type="variances_serialized_down"
          onDownload={handleDownload}
        />
      </ExportGroup>

      <ExportGroup heading="Record keeping" as={SectionHeading}>
        <ExportRow
          icon={MessageSquare}
          title="Queries"
          description="All team-to-supervisor queries with full conversation history, status, and resolution timestamps."
          type="queries"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={Package}
          title="Breakdowns"
          description="All stock movement / breakdown requests with approval status, client names, PO numbers, and conversation history."
          type="breakdowns"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={ClipboardCheck}
          title="Verification assignments"
          description="All recount assignments — original count, verification count, assigned team, status, and completion details."
          type="verifications"
          onDownload={handleDownload}
        />
        <ExportRow
          icon={ScrollText}
          title="Audit log"
          description="Complete audit trail of all supervisor actions — edits, approvals, assignments, and status changes with timestamps."
          type="audit_log"
          onDownload={handleDownload}
        />
      </ExportGroup>
    </div>
  );
}

/** A titled list of export rows in one neutral card. */
function ExportGroup({ heading, as: Heading, children }: { heading: string; as: "h2" | "h3"; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <Heading className="text-base font-semibold text-slate-900">{heading}</Heading>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">{children}</ul>
    </section>
  );
}

/** One export: what it contains, with Excel and CSV buttons. */
function ExportRow({
  icon: Icon,
  title,
  description,
  type,
  onDownload,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  type: string;
  onDownload: (type: string, format: string) => void;
}) {
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">{title}</div>
          <p className="mt-0.5 text-sm text-slate-600">{description}</p>
        </div>
      </div>
      <div className="pl-7 sm:pl-0">
        <ExportButtons type={type} label={title} onDownload={onDownload} />
      </div>
    </li>
  );
}

function ExportButtons({
  type,
  label,
  onDownload,
}: {
  type: string;
  label: string;
  onDownload: (type: string, format: string) => void;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onDownload(type, "xlsx")}
        aria-label={`${label}: download Excel`}
      >
        <FileSpreadsheet />
        Excel
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onDownload(type, "csv")}
        aria-label={`${label}: download CSV`}
      >
        <FileText />
        CSV
      </Button>
    </div>
  );
}
