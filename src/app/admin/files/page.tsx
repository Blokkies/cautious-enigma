"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, Trash2, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

const statusColors: Record<string, string> = {
  setup: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-blue-100 text-blue-800",
  locked: "bg-gray-100 text-gray-800",
};

export default function AdminFilesPage() {
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<UploadFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUploads = async () => {
    try {
      const res = await fetch("/api/admin/uploads");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUploads(data.uploads || []);
    } catch {
      toast.error("Failed to load files");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUploads();
  }, []);

  const handleDownload = async (upload: UploadFile) => {
    try {
      const res = await fetch(`/api/admin/uploads/${upload.id}/download`);
      if (!res.ok) throw new Error("Download failed");
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
      toast.error("Failed to download file");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/uploads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          toast.error(`Cannot delete: linked to ${data.linkedEvents?.join(", ")}`);
        } else {
          toast.error(data.error || "Failed to delete");
        }
        return;
      }
      toast.success("File deleted");
      setUploads((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    } catch {
      toast.error("Failed to delete file");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Uploaded Files</h1>

      {uploads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No files uploaded yet</p>
            <p className="text-sm mt-1">
              Files will appear here when you import an Excel file during event setup.
            </p>
          </CardContent>
        </Card>
      ) : (
        uploads.map((upload) => {
          const hasLinkedEvents = upload.linkedEvents.length > 0;
          return (
            <Card key={upload.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="h-5 w-5 text-green-600 shrink-0" />
                    <CardTitle className="text-base truncate">
                      {upload.filename}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(upload)}
                      title="Download file"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(upload)}
                      disabled={hasLinkedEvents}
                      title={
                        hasLinkedEvents
                          ? `Used by ${upload.linkedEvents.length} event(s) — unlink or delete events first`
                          : "Delete file"
                      }
                      className={hasLinkedEvents ? "opacity-40" : "text-destructive hover:text-destructive"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{formatFileSize(upload.fileSize)}</span>
                  <span>Uploaded {formatDate(upload.createdAt)}</span>
                </div>

                {upload.linkedEvents.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Linked Events
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {upload.linkedEvents.map((event) => (
                        <Badge
                          key={event.id}
                          variant="secondary"
                          className={statusColors[event.status] || ""}
                        >
                          {event.name} ({event.status})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.filename}&quot;? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
