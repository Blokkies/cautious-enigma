"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Archive,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  Users,
  MessageSquare,
  Package,
  ScanBarcode,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { downloadAllAsZip } from "@/lib/download-all-zip";
import { adminRoutes } from "@/lib/admin-routes";
import { formatMoney, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";
import { PageSkeleton } from "@/components/admin/loading-state";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

interface EventSummary {
  id: number;
  name: string;
  location: string | null;
  status: string;
  startDate: string | null;
  totalItems: number;
  countedItems: number;
  matchedItems: number;
  varianceItems: number;
  varianceValue: number;
  overCount: number;
  overValue: number;
  underCount: number;
  underValue: number;
  netVarianceValue: number;
  progressPercent: number;
  teamCount: number;
  supervisorCount: number;
  openQueries: number;
  pendingBreakdowns: number;
  openSerialDiscrepancies: number;
  /** Setup checklist counts (setup events only). */
  setup: { itemCount: number; teamCount: number; supervisorCount: number; unassignedCount: number } | null;
}

// Overview. Interim: the previous dashboard inside the new shell; phase 2 rebuilds it
// (welcome card, status tiles, Live now / In setup / Finished groups).
export default function AdminOverviewPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingEventId, setDownloadingEventId] = useState<number | null>(null);
  const router = useRouter();

  const handleDownloadAll = async (e: React.MouseEvent, event: EventSummary) => {
    e.stopPropagation();
    setDownloadingEventId(event.id);
    try {
      const safeName = event.name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_");
      await downloadAllAsZip(event.id, `${safeName}_all_exports.zip`);
      toast.success("ZIP download started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ZIP download failed");
    } finally {
      setDownloadingEventId(null);
    }
  };

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dashboard");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events);
      }
    } catch {
      // will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 15000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  if (loading) {
    return <PageSkeleton />;
  }

  // Live first (by progress ascending), then setup, then completed/locked
  const rank = (status: string) => (status === "active" ? 0 : status === "setup" ? 1 : 2);
  const sorted = [...events].sort((a, b) => rank(a.status) - rank(b.status) || a.progressPercent - b.progressPercent);

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="Overview"
        description="Every stocktake at a glance. Live counts refresh every 15 seconds."
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No stocktakes yet"
          description="A stocktake goes through five phases: set up, go live, count, review, then close and export to NetSuite. Start by creating your first one."
          action={
            <Button asChild>
              <Link href={adminRoutes.events}>Create your first stocktake</Link>
            </Button>
          }
        />
      ) : (
        sorted.map((event) => event.setup ? (
          <Card
            key={event.id}
            className="cursor-pointer transition-colors hover:border-slate-300"
            onClick={() => router.push(adminRoutes.event(event.id))}
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{event.name}</h2>
                  {event.location && <div className="text-sm text-muted-foreground">{event.location}</div>}
                </div>
                <StatusBadge status={event.status} />
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <li><span className="font-semibold tabular-nums">{formatNumber(event.setup.itemCount)}</span> <span className="text-muted-foreground">items</span></li>
                <li><span className="font-semibold tabular-nums">{event.setup.teamCount}</span> <span className="text-muted-foreground">teams</span></li>
                <li><span className="font-semibold tabular-nums">{event.setup.supervisorCount}</span> <span className="text-muted-foreground">supervisors</span></li>
                <li><span className="font-semibold tabular-nums">{formatNumber(event.setup.unassignedCount)}</span> <span className="text-muted-foreground">unassigned</span></li>
              </ul>
            </CardContent>
          </Card>
        ) : (
          <Card
            key={event.id}
            className="cursor-pointer transition-colors hover:border-slate-300"
            onClick={() => router.push(adminRoutes.event(event.id, "results"))}
          >
            <CardContent className="pt-6">
              {/* Header: name + location + status badge */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{event.name}</h2>
                  {event.location && (
                    <div className="text-sm text-muted-foreground">
                      {event.location}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={downloadingEventId === event.id}
                    onClick={(e) => handleDownloadAll(e, event)}
                    title="Download all exports as ZIP"
                  >
                    {downloadingEventId === event.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </Button>
<StatusBadge status={event.status} />
                </div>
              </div>

              {/* Progress */}
              <div className="text-center mb-3">
                <div className="text-4xl font-bold text-primary">
                  {event.progressPercent}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {event.countedItems} / {event.totalItems} items counted
                </div>
              </div>
              <Progress
                value={event.progressPercent}
                className="h-3 mb-4"
              />

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-4 text-center mb-4">
                <div>
                  <div className="text-xl font-bold text-green-600">
                    {event.matchedItems}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Matched
                  </div>
                </div>
                <div>
                  <div className="text-xl font-bold text-amber-600">
                    {event.varianceItems}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Variances
                  </div>
                </div>
                <div>
                  <div className="text-xl font-bold text-gray-500">
                    {event.totalItems - event.countedItems}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <Clock className="h-3 w-3" />
                    Pending
                  </div>
                </div>
              </div>

              {/* Variance breakdown strip */}
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/40 rounded-lg mb-4 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-amber-600 font-semibold">
                    {formatMoney(event.overValue, { decimals: 0 })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    ({event.overCount}) over
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-red-600 font-semibold">
                    {formatMoney(event.underValue, { decimals: 0 })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    ({event.underCount}) under
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`font-semibold ${event.netVarianceValue >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatMoney(event.netVarianceValue, { decimals: 0 })}
                  </span>
                  <span className="text-muted-foreground text-xs">net</span>
                </div>
              </div>

              {/* Footer: teams, supervisors, queries, breakdowns, serial discrepancies */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground border-t pt-3">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {event.teamCount} teams
                </span>
                <span className="flex items-center gap-1">
                  <UserCheck className="h-3 w-3" />
                  {event.supervisorCount} supervisors
                </span>
                {event.openQueries > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-amber-400 text-amber-700"
                  >
                    <MessageSquare className="h-3 w-3 mr-1" />
                    {event.openQueries} open queries
                  </Badge>
                )}
                {event.pendingBreakdowns > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-amber-400 text-amber-700"
                  >
                    <Package className="h-3 w-3 mr-1" />
                    {event.pendingBreakdowns} pending breakdowns
                  </Badge>
                )}
                {event.openSerialDiscrepancies > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-purple-400 text-purple-700"
                  >
                    <ScanBarcode className="h-3 w-3 mr-1" />
                    {event.openSerialDiscrepancies} serial discrepancies
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
