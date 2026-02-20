"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Archive,
  Download,
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
} from "lucide-react";
import { toast } from "sonner";
import { downloadAllAsZip } from "@/lib/download-all-zip";

interface ExportStats {
  total: number;
  counted: number;
  matched: number;
  withVariance: number;
  progressPercent: number;
}

export default function ExportPage() {
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/dashboard");
      if (res.ok) {
        const data = await res.json();
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
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleDownload = async (type: string, format: string) => {
    try {
      const res = await fetch(
        `/api/supervisor/export?type=${type}&format=${format}`
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
      await downloadAllAsZip(undefined, "stocktake_all_exports.zip", (done, total) => {
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

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Export Data</h1>

      {stats && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Items</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">
                  {stats.progressPercent}%
                </div>
                <div className="text-xs text-muted-foreground">Completed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {stats.matched}
                </div>
                <div className="text-xs text-muted-foreground">Matched</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">
                  {stats.withVariance}
                </div>
                <div className="text-xs text-muted-foreground">Variances</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Download All as ZIP */}
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={handleDownloadAll}
        disabled={zipping}
      >
        {zipping ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {zipProgress}
          </>
        ) : (
          <>
            <Archive className="h-5 w-5" />
            Download All Data (ZIP)
          </>
        )}
      </Button>

      {/* Master Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Master Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            All items with count results, variances, team assignments, comments,
            check status, count type, and serialized flag.
            Includes unknown and approved serials.
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => handleDownload("full", "xlsx")}
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel (.xlsx)
            </Button>
            <Button
              onClick={() => handleDownload("full", "csv")}
              variant="outline"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Variance Exports */}
      <h2 className="text-lg font-semibold pt-2">Variance Exports</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Non-Serialized Variances UP */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Non-Serialized Variances UP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Non-serialized items where counted quantity exceeds on-hand (surplus).
            </p>
            <ExportButtons type="variances_nonserialized_up" onDownload={handleDownload} />
          </CardContent>
        </Card>

        {/* Non-Serialized Variances DOWN */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-5 w-5 text-red-600" />
              Non-Serialized Variances DOWN
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Non-serialized items where counted quantity is less than on-hand (shortage).
            </p>
            <ExportButtons type="variances_nonserialized_down" onDownload={handleDownload} />
          </CardContent>
        </Card>

        {/* Serialized Variances UP */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="relative">
                <ScanBarcode className="h-5 w-5 text-blue-600" />
                <TrendingUp className="h-3 w-3 text-blue-600 absolute -bottom-1 -right-1.5" />
              </div>
              Serialized Variances UP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Unknown serials reported during count (not in system). Includes approved serials.
            </p>
            <ExportButtons type="variances_serialized_up" onDownload={handleDownload} />
          </CardContent>
        </Card>

        {/* Serialized Variances DOWN */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="relative">
                <ScanBarcode className="h-5 w-5 text-red-600" />
                <TrendingDown className="h-3 w-3 text-red-600 absolute -bottom-1 -right-1.5" />
              </div>
              Serialized Variances DOWN
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Expected serialized items that were not found during the count.
            </p>
            <ExportButtons type="variances_serialized_down" onDownload={handleDownload} />
          </CardContent>
        </Card>
      </div>

      {/* All Variances */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            All Variances
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            All items with discrepancies — serialized and non-serialized, up and
            down. Includes check status and count type.
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => handleDownload("variances_all", "xlsx")}
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel (.xlsx)
            </Button>
            <Button
              onClick={() => handleDownload("variances_all", "csv")}
              variant="outline"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Serial Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Serial Number Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Complete serial number audit — every expected serial with found/not-found status,
            plus all unknown and approved serials. Includes full item metadata, verification
            results, and discrepancy resolution details.
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => handleDownload("serials", "xlsx")}
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel (.xlsx)
            </Button>
            <Button
              onClick={() => handleDownload("serials", "csv")}
              variant="outline"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Record-keeping exports */}
      <h2 className="text-lg font-semibold pt-2">Record Keeping</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Queries */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Queries
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              All team-to-supervisor queries with full conversation history,
              status, and resolution timestamps.
            </p>
            <ExportButtons type="queries" onDownload={handleDownload} />
          </CardContent>
        </Card>

        {/* Breakdowns */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5 text-purple-600" />
              Breakdowns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              All stock movement / breakdown requests with approval status,
              client names, PO numbers, and conversation history.
            </p>
            <ExportButtons type="breakdowns" onDownload={handleDownload} />
          </CardContent>
        </Card>

        {/* Verification Assignments */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-5 w-5 text-emerald-600" />
              Verification Assignments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              All recount assignments — original count, verification count,
              assigned team, status, and completion details.
            </p>
            <ExportButtons type="verifications" onDownload={handleDownload} />
          </CardContent>
        </Card>

        {/* Audit Log */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-5 w-5 text-gray-600" />
              Audit Log
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Complete audit trail of all supervisor actions — edits,
              approvals, assignments, and status changes with timestamps.
            </p>
            <ExportButtons type="audit_log" onDownload={handleDownload} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ExportButtons({
  type,
  onDownload,
}: {
  type: string;
  onDownload: (type: string, format: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        onClick={() => onDownload(type, "xlsx")}
        className="gap-1.5"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Excel
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onDownload(type, "csv")}
        className="gap-1.5"
      >
        <FileText className="h-3.5 w-3.5" />
        CSV
      </Button>
    </div>
  );
}
