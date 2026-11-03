"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Package,
  Tag,
  Upload,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber, plural } from "@/lib/format";
import { sampleStockCsv } from "@/lib/sample-stock-csv";
import { useAdminEvent } from "../event-context";
import { useConfirm } from "../confirm-dialog";
import { StatCard } from "../stat-card";
import { statusMeta } from "../status";
import { StatCardsSkeleton } from "../loading-state";
import { ErrorState } from "../error-state";
import { InfoNote, PanelSection, ReadOnlyNotice } from "./panel-section";
import { downloadBlob, useItemsOverview, useJson } from "./use-event-data";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface ImportReport {
  source: "upload" | "copy";
  fileName?: string;
  totalItems: number;
  rawRowCount?: number;
  /** "Header -> field" pairs from the importer. */
  mappedFields: string[];
  unmappedHeaders: string[];
  /** Set when the file was rejected (e.g. no item code column). */
  error?: string;
}

interface CopySource {
  id: number;
  name: string;
  status: string;
  itemCount: number;
}

type UploadPhase = { kind: "idle" } | { kind: "uploading"; percent: number | null } | { kind: "processing" };

/** Human-readable size: 1.2 MB. */
function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Import/replace the event's stock file, or copy items from another event. */
export function ItemsPanel({ onChanged }: { onChanged?: () => void }) {
  const { event, reload: reloadEvent } = useAdminEvent();
  const eventId = event!.id;
  const inSetup = event!.status === "setup";
  const overview = useItemsOverview(eventId);
  const [confirm, confirmDialog] = useConfirm();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [mode, setMode] = useState<"upload" | "copy">("upload");

  const itemCount = overview.data?.summary.totalItems ?? 0;

  const afterChange = useCallback(() => {
    void overview.reload();
    void reloadEvent();
    onChanged?.();
  }, [overview, reloadEvent, onChanged]);

  /** Ask before replacing existing items. */
  const confirmReplace = async (): Promise<boolean> => {
    if (itemCount <= 0) return true;
    return confirm({
      title: "Replace the existing items?",
      description: (
        <>
          <p>
            This stocktake already has {plural(itemCount, "item")}. Importing replaces all of them:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>every bin assignment is removed, so bins must be assigned to teams again;</li>
            <li>open queries and breakdowns are deleted;</li>
            <li>the warehouse selection is kept where those warehouses still exist.</li>
          </ul>
          <p>Teams, supervisors and auditors are kept.</p>
        </>
      ),
      confirmLabel: "Replace items",
      destructive: true,
    });
  };

  /** Server said counts exist (409 requiresConfirm). */
  const confirmDeleteCounts = (message: string) =>
    confirm({
      title: "Delete the recorded counts?",
      description: (
        <>
          <p>{message}</p>
          <p>Continue only if you are sure the counts are no longer needed. This cannot be undone.</p>
        </>
      ),
      confirmLabel: "Delete counts and import",
      destructive: true,
    });

  if (overview.loading) return <StatCardsSkeleton />;
  if (overview.error && !overview.data) {
    return <ErrorState title="Could not load the items" message={overview.error} onRetry={() => void overview.reload()} />;
  }

  return (
    <div className="space-y-6">
      {!inSetup && (
        <ReadOnlyNotice>
          The stock file is locked because this stocktake is <strong>{statusMeta(event!.status).label.toLowerCase()}</strong>.
          Teams are counting against these items. To replace the file, move the stocktake back to setup on the Overview
          tab first. Re-importing then deletes any counts already recorded.
        </ReadOnlyNotice>
      )}

      <CurrentItems eventId={eventId} eventName={event!.name} data={overview.data} />

      {report && <ImportReportView report={report} onDismiss={() => setReport(null)} />}

      {inSetup && (
        <PanelSection
          title={itemCount > 0 ? "Replace the stock file" : "Import the stock file"}
          description="Upload a NetSuite inventory export, or reuse the items of an earlier stocktake."
        >
          <div role="tablist" aria-label="Import method" className="mb-4 inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                ["upload", "Upload a file", Upload],
                ["copy", "Copy from a stocktake", Copy],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === value ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          {mode === "upload" ? (
            <UploadForm
              eventId={eventId}
              confirmReplace={confirmReplace}
              confirmDeleteCounts={confirmDeleteCounts}
              onReport={setReport}
              onDone={afterChange}
            />
          ) : (
            <CopyForm
              eventId={eventId}
              confirmReplace={confirmReplace}
              confirmDeleteCounts={confirmDeleteCounts}
              onReport={setReport}
              onDone={afterChange}
            />
          )}
        </PanelSection>
      )}

      {confirmDialog}
    </div>
  );
}

function CurrentItems({
  eventId,
  eventName,
  data,
}: {
  eventId: number;
  eventName: string;
  data: ReturnType<typeof useItemsOverview>["data"];
}) {
  const s = data?.summary;
  if (!s || s.totalItems === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5">
        <Package className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-slate-900">No items yet</p>
          <p className="text-sm text-slate-600">Import the stock file below. Teams count against these items.</p>
        </div>
      </div>
    );
  }
  const warehouseCount = data!.warehouses.length;
  return (
    <PanelSection
      title="Current items"
      description={
        data!.upload ? (
          <>
            From <span className="font-medium text-slate-800">{data!.upload.filename}</span> ({fileSize(data!.upload.fileSize)})
            {warehouseCount > 0 && <>, {plural(warehouseCount, "warehouse")}</>}
          </>
        ) : (
          <>Copied from another stocktake{warehouseCount > 0 && <>, {plural(warehouseCount, "warehouse")}</>}</>
        )
      }
      actions={
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/admin/export?eventId=${eventId}`} download>
            <Download />
            Download imported items
          </a>
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Items" value={formatNumber(s.totalItems)} icon={Package} hint="rows with an item code" />
        <StatCard label="Bins" value={formatNumber(s.uniqueBins)} icon={Boxes} />
        <StatCard label="Brands" value={formatNumber(s.uniqueBrands)} icon={Tag} />
        <StatCard label="Stock value" value={formatMoney(s.totalValue, { decimals: 0 })} icon={Wallet} hint="on hand x average cost" />
      </div>
      <span className="sr-only">Items of {eventName}</span>
    </PanelSection>
  );
}

function ImportReportView({ report, onDismiss }: { report: ImportReport; onDismiss: () => void }) {
  const failed = !!report.error;
  const skipped = report.rawRowCount !== undefined ? report.rawRowCount - report.totalItems : 0;
  return (
    <section
      aria-live="polite"
      className={cn("rounded-lg border p-4 sm:p-5", failed ? "border-red-200 bg-red-50/50" : "border-emerald-200 bg-emerald-50/40")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {failed ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          )}
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {failed
                ? "The file was not imported"
                : report.source === "copy"
                  ? `Copied ${plural(report.totalItems, "item")}`
                  : `Imported ${plural(report.totalItems, "item")}`}
            </h3>
            <p className="text-sm text-slate-600">
              {failed
                ? report.error
                : report.source === "upload"
                  ? `${report.fileName ?? "File"}${report.rawRowCount !== undefined ? `: ${plural(report.rawRowCount, "row")} read` : ""}${skipped > 0 ? `, ${formatNumber(skipped)} skipped because they had no item code` : ""}.`
                  : "Items were copied without bin assignments. Assign bins to teams again."}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      {report.source === "upload" && (report.mappedFields.length > 0 || report.unmappedHeaders.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-900">Recognised columns ({report.mappedFields.length})</h4>
            {report.mappedFields.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {report.mappedFields.map((m) => {
                  const [header, field] = m.split(" -> ");
                  return (
                    <li key={m} className="rounded border border-emerald-200 bg-white px-2 py-0.5 text-xs text-slate-700">
                      {header}
                      {field && <span className="text-slate-400"> as {field}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">None. Check that the first row holds the column headers.</p>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-900">Ignored columns ({report.unmappedHeaders.length})</h4>
            {report.unmappedHeaders.length > 0 ? (
              <>
                <ul className="flex flex-wrap gap-1.5">
                  {report.unmappedHeaders.map((h) => (
                    <li key={h} className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                      {h || "(blank header)"}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  These were not read. That is fine for extra columns; if one of them holds bins, quantities or costs, rename
                  the header to an accepted name and import again.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-600">None. Every column was used.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface FormProps {
  eventId: number;
  confirmReplace: () => Promise<boolean>;
  confirmDeleteCounts: (message: string) => Promise<boolean>;
  onReport: (report: ImportReport | null) => void;
  onDone: () => void;
}

function UploadForm({ eventId, confirmReplace, confirmDeleteCounts, onReport, onDone }: FormProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const busy = phase.kind !== "idle";

  useEffect(() => () => xhrRef.current?.abort(), []);

  const pickFile = (f: File | null) => {
    if (f && f.size > MAX_FILE_BYTES) {
      toast.error(`${f.name} is ${fileSize(f.size)}. The limit is 50 MB: remove unused columns or split the export.`);
      return;
    }
    setFile(f);
  };

  const send = (f: File, confirmed: boolean) => {
    const form = new FormData();
    form.append("file", f);
    form.append("eventId", String(eventId));
    if (confirmed) form.append("confirm", "true");

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    setPhase({ kind: "uploading", percent: 0 });
    xhr.upload.addEventListener("progress", (e) => {
      setPhase({ kind: "uploading", percent: e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null });
    });
    // Upload finished; the server now parses and saves. We can't measure that, so no percentage.
    xhr.upload.addEventListener("load", () => setPhase({ kind: "processing" }));
    xhr.addEventListener("load", async () => {
      xhrRef.current = null;
      setPhase({ kind: "idle" });
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        const summary = (data.summary ?? {}) as Record<string, unknown>;
        onReport({
          source: "upload",
          fileName: f.name,
          totalItems: Number(summary.totalItems) || 0,
          rawRowCount: typeof summary.rawRowCount === "number" ? summary.rawRowCount : undefined,
          mappedFields: Array.isArray(summary.mappedFields) ? (summary.mappedFields as string[]) : [],
          unmappedHeaders: Array.isArray(summary.unmappedHeaders) ? (summary.unmappedHeaders as string[]) : [],
        });
        toast.success(`Imported ${plural(Number(summary.totalItems) || 0, "item")}`);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        onDone();
        return;
      }
      if (xhr.status === 409 && data.requiresConfirm) {
        if (await confirmDeleteCounts(String(data.error ?? "Counts have been recorded."))) send(f, true);
        return;
      }
      const error = typeof data.error === "string" ? data.error : `Import failed (HTTP ${xhr.status}).`;
      if (Array.isArray(data.mappedFields) || Array.isArray(data.unmappedHeaders)) {
        onReport({
          source: "upload",
          fileName: f.name,
          totalItems: 0,
          mappedFields: (data.mappedFields as string[]) ?? [],
          unmappedHeaders: (data.unmappedHeaders as string[]) ?? [],
          error: `${error}. Every row needs an item code; check the column headers below.`,
        });
      }
      toast.error(error);
    });
    xhr.addEventListener("error", () => {
      xhrRef.current = null;
      setPhase({ kind: "idle" });
      toast.error("The upload was interrupted. Check your connection and try again.");
    });
    xhr.open("POST", "/api/admin/import");
    xhr.send(form);
  };

  const start = async () => {
    if (!file || busy) return;
    if (!(await confirmReplace())) return;
    onReport(null);
    send(file, false);
  };

  const downloadSample = () => {
    downloadBlob(new Blob([sampleStockCsv()], { type: "text/csv;charset=utf-8" }), "sample-stock-file.csv");
  };

  return (
    <div className="space-y-4">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50",
          busy && "pointer-events-none opacity-60"
        )}
      >
        <FileSpreadsheet className="h-8 w-8 text-slate-400" aria-hidden="true" />
        {file ? (
          <span className="text-sm">
            <span className="font-medium text-slate-900">{file.name}</span>{" "}
            <span className="text-slate-500">({fileSize(file.size)})</span>
          </span>
        ) : (
          <span className="text-sm text-slate-600">
            <span className="font-medium text-primary">Choose a file</span> or drag it here
          </span>
        )}
        <span className="text-xs text-slate-500">CSV (comma-separated), .xlsx or .xls, up to 50 MB</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="sr-only"
          disabled={busy}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {phase.kind === "uploading" && (
        <div className="space-y-1.5" role="status">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Uploading
            </span>
            {phase.percent !== null && <span className="tabular-nums text-slate-500">{phase.percent}%</span>}
          </div>
          <Progress value={phase.percent ?? 0} className="h-2" />
        </div>
      )}
      {phase.kind === "processing" && (
        <div className="space-y-1.5" role="status">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Processing: reading rows and saving items. Large files can take a minute; keep this page open.
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-primary/15">
            <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-40" />
          </div>
          <style>{`@keyframes indeterminate{0%{left:-33%}100%{left:100%}}`}</style>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={downloadSample}
          className="inline-flex items-center gap-1.5 rounded text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download a sample file
        </button>
        <Button onClick={() => void start()} disabled={!file || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {busy ? "Importing" : "Import file"}
        </Button>
      </div>
    </div>
  );
}

function CopyForm({ eventId, confirmReplace, confirmDeleteCounts, onReport, onDone }: FormProps) {
  const sources = useJson<{ events: CopySource[] }>("/api/admin/import");
  const [sourceId, setSourceId] = useState("");
  const [copying, setCopying] = useState(false);
  const options = (sources.data?.events ?? []).filter((e) => e.id !== eventId);

  const copy = async (confirmed: boolean): Promise<void> => {
    setCopying(true);
    try {
      const res = await fetch("/api/admin/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEventId: Number(sourceId), targetEventId: eventId, confirm: confirmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const total = Number(data.summary?.totalItems) || 0;
        onReport({ source: "copy", totalItems: total, mappedFields: [], unmappedHeaders: [] });
        toast.success(`Copied ${plural(total, "item")}`);
        void sources.reload();
        onDone();
      } else if (res.status === 409 && data.requiresConfirm) {
        setCopying(false);
        if (await confirmDeleteCounts(data.error)) await copy(true);
      } else {
        toast.error(data.error || "Copy failed");
      }
    } catch {
      toast.error("Could not reach the server. Nothing was copied.");
    } finally {
      setCopying(false);
    }
  };

  const start = async () => {
    if (!sourceId || copying) return;
    if (!(await confirmReplace())) return;
    onReport(null);
    await copy(false);
  };

  if (sources.loading) return <p className="text-sm text-slate-500">Loading stocktakes…</p>;
  if (options.length === 0) {
    return <InfoNote>No other stocktake has items to copy yet. Upload a file instead.</InfoNote>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Copies every item of the chosen stocktake into this one. Bin assignments, teams and counts are not copied; this
        stocktake gets its own independent copy.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={sourceId} onValueChange={setSourceId}>
          <SelectTrigger className="sm:flex-1" aria-label="Stocktake to copy from">
            <SelectValue placeholder="Choose a stocktake to copy from" />
          </SelectTrigger>
          <SelectContent>
            {options.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.name} ({plural(e.itemCount, "item")}, {statusMeta(e.status).label.toLowerCase()})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => void start()} disabled={!sourceId || copying}>
          {copying ? <Loader2 className="animate-spin" /> : <Copy />}
          {copying ? "Copying" : "Copy items"}
        </Button>
      </div>
    </div>
  );
}
