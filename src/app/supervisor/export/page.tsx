"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
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

      {/* Full Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Full Stocktake Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            All items with their count results, variances, team assignments, and
            comments. Suitable for NetSuite import.
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => handleDownload("full", "xlsx")}
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Download Excel (.xlsx)
            </Button>
            <Button
              onClick={() => handleDownload("full", "csv")}
              variant="outline"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Variances Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Variances Only
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Only items with count discrepancies, sorted by variance value
            (highest first).
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => handleDownload("variances", "xlsx")}
              className="gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Download Excel (.xlsx)
            </Button>
            <Button
              onClick={() => handleDownload("variances", "csv")}
              variant="outline"
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
