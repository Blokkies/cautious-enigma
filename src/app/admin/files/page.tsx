"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Info, Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { ListSkeleton } from "@/components/admin/loading-state";
import { StatusBadge } from "@/components/admin/status-badge";
import { useConfirm } from "@/components/admin/confirm-dialog";
import { parseTimestamp } from "@/components/admin/event-list";
import { adminRoutes } from "@/lib/admin-routes";
import { formatDate } from "@/lib/format";

interface LinkedEvent {
  id: number;
  name: string;
  status: string;
}

interface UploadFile {
  id: number;
  filename: string;
  fileSize: number;
  mimeType: string | null;
  uploadedBy: number | null;
  createdAt: string;
  linkedEvents: LinkedEvent[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadedOn(value: string): string {
  const d = parseTimestamp(value);
  if (!d) return formatDate(value);
  const time = d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
  return `${formatDate(local)}, ${time}`;
}

export default function AdminFilesPage() {
  const [uploads, setUploads] = useState<UploadFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/uploads", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
      setUploads(data?.uploads ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void load();
  }, [load]);

  const retry = () => {
    setLoading(true);
    load();
  };

  const handleDownload = async (upload: UploadFile) => {
    setDownloadingId(upload.id);
    try {
      const res = await fetch(`/api/admin/uploads/${upload.id}/download`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = upload.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(`"${upload.filename}" could not be downloaded. Try again.`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (upload: UploadFile) => {
    const ok = await confirm({
      title: `Delete "${upload.filename}"?`,
      description: (
        <p>
          The original file is removed from storage. No stocktake uses it any more, so no items or counts are affected.
          This cannot be undone.
        </p>
      ),
      confirmLabel: "Delete file",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch("/api/admin/uploads", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: upload.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 409 && Array.isArray(data.linkedEvents)) {
            throw new Error(`It is still used by ${data.linkedEvents.join(", ")}. Reload the page to see the latest links.`);
          }
          throw new Error(data.error || "The file could not be deleted.");
        }
      },
    });
    if (ok) {
      toast.success(`"${upload.filename}" deleted`);
      setUploads((prev) => prev?.filter((u) => u.id !== upload.id) ?? null);
    }
  };

  return (
    <>
      <PageHeader
        title="Files"
        description="The original stock files uploaded to your stocktakes. Download one to check exactly what was imported."
      />
      {confirmDialog}

      <div className="space-y-6">
        <aside className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1.5">
            <p>
              Each time you upload a stock file, the original is kept here exactly as uploaded. Copying items from another
              stocktake reuses that stocktake&apos;s file, so one file can be linked to several events.
            </p>
            <p>
              A file can only be deleted once no stocktake uses it. Replacing a stocktake&apos;s stock file removes the old one
              automatically when nothing else links to it. Deleting a stocktake leaves its file here so you can still download it.
            </p>
          </div>
        </aside>

        {uploads === null ? (
          error ? (
            <ErrorState title="Could not load files" message={error} onRetry={retry} retrying={loading} />
          ) : (
            <ListSkeleton rows={4} />
          )
        ) : uploads.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No files yet"
            description="Files appear here when you upload a stock file to a stocktake."
            action={
              <Button asChild variant="outline">
                <Link href={adminRoutes.events}>Go to events</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {uploads.map((upload) => {
              const linked = upload.linkedEvents.length > 0;
              return (
                <li key={upload.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <div className="break-all text-sm font-medium text-slate-900">{upload.filename}</div>
                      <div className="text-xs text-slate-500">
                        <span className="tabular-nums">{formatFileSize(upload.fileSize)}</span>, uploaded {uploadedOn(upload.createdAt)}
                      </div>
                    </div>
                    {linked ? (
                      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Used by">
                        {upload.linkedEvents.map((ev) => (
                          <li key={ev.id} className="flex items-center gap-2 text-xs">
                            <Link href={adminRoutes.event(ev.id, "items")} className="font-medium text-slate-700 hover:text-primary hover:underline">
                              {ev.name}
                            </Link>
                            <StatusBadge status={ev.status} size="sm" />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">Not used by any stocktake.</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownload(upload)} disabled={downloadingId === upload.id}>
                      {downloadingId === upload.id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Download />}
                      Download
                    </Button>
                    {linked ? (
                      <span
                        className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-slate-400"
                        title={`In use by ${upload.linkedEvents.length} ${upload.linkedEvents.length === 1 ? "stocktake" : "stocktakes"}. Replace their stock file or delete them first.`}
                      >
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        In use
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => handleDelete(upload)}
                      >
                        <Trash2 />
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
