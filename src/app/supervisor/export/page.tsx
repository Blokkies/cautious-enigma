"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ScanBarcode,
} from "lucide-react";
import { toast } from "sonner";

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
      a.download =
        format === "csv"
          ? `stocktake_${type}.csv`
          : `stocktake_${type}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Download started");
    } catch {
      toast.error("Download failed");
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
            All items with count results, variances, team assignments, and
            comments. Includes unknown and approved serials. Suitable for NetSuite import.
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
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleDownload("variances_nonserialized_up", "xlsx")}
                className="gap-1.5"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload("variances_nonserialized_up", "csv")}
                className="gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
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
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleDownload("variances_nonserialized_down", "xlsx")}
                className="gap-1.5"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload("variances_nonserialized_down", "csv")}
                className="gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
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
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleDownload("variances_serialized_up", "xlsx")}
                className="gap-1.5"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload("variances_serialized_up", "csv")}
                className="gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
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
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleDownload("variances_serialized_down", "xlsx")}
                className="gap-1.5"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload("variances_serialized_down", "csv")}
                className="gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
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
            down. Includes unknown and approved serials.
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
    </div>
  );
}
