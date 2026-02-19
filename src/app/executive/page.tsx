"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Package,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Users,
  MessageSquare,
  FileWarning,
  MapPin,
} from "lucide-react";

interface EventStats {
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
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value);
}

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  completed: "bg-blue-500/10 text-blue-700 border-blue-500/20",
};

export default function ExecutiveDashboard() {
  const router = useRouter();
  const [events, setEvents] = useState<EventStats[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/executive/dashboard");
      if (res.ok) {
        const data = await res.json();
        const eventList: EventStats[] = data.events || [];
        setEvents(eventList);
        setSelectedIds((prev) => {
          if (prev.size === 0) {
            return new Set(eventList.filter((e) => e.status === "active").map((e) => e.id));
          }
          return prev;
        });
      }
    } catch {
      // network error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleEvent = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selected = events.filter((e) => selectedIds.has(e.id));

  // Consolidated summary
  const consolidated = selected.reduce(
    (acc, e) => ({
      totalItems: acc.totalItems + Number(e.totalItems),
      countedItems: acc.countedItems + Number(e.countedItems),
      matchedItems: acc.matchedItems + Number(e.matchedItems),
      varianceItems: acc.varianceItems + Number(e.varianceItems),
      varianceValue: acc.varianceValue + Number(e.varianceValue),
      overCount: acc.overCount + Number(e.overCount),
      overValue: acc.overValue + Number(e.overValue),
      underCount: acc.underCount + Number(e.underCount),
      underValue: acc.underValue + Number(e.underValue),
      teamCount: acc.teamCount + Number(e.teamCount),
      supervisorCount: acc.supervisorCount + Number(e.supervisorCount),
      openQueries: acc.openQueries + Number(e.openQueries),
      pendingBreakdowns: acc.pendingBreakdowns + Number(e.pendingBreakdowns),
      openSerialDiscrepancies: acc.openSerialDiscrepancies + Number(e.openSerialDiscrepancies),
    }),
    {
      totalItems: 0,
      countedItems: 0,
      matchedItems: 0,
      varianceItems: 0,
      varianceValue: 0,
      overCount: 0,
      overValue: 0,
      underCount: 0,
      underValue: 0,
      teamCount: 0,
      supervisorCount: 0,
      openQueries: 0,
      pendingBreakdowns: 0,
      openSerialDiscrepancies: 0,
    }
  );

  const consolidatedProgress =
    consolidated.totalItems > 0
      ? Math.round((consolidated.countedItems / consolidated.totalItems) * 100)
      : 0;

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading dashboard...</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No active or completed events found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Executive Dashboard</h1>

      {/* Event selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Select Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {events.map((event) => (
              <label
                key={event.id}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.has(event.id)}
                  onCheckedChange={() => toggleEvent(event.id)}
                />
                <span className="text-sm font-medium">{event.name}</span>
                <Badge variant="outline" className={statusColors[event.status] || ""}>
                  {event.status}
                </Badge>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Consolidated summary (shown when >1 event selected) */}
      {selected.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Consolidated Summary ({selected.length} events)</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Overall Progress</span>
                <span className="font-bold">{consolidatedProgress}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${consolidatedProgress}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <StatBox icon={Package} label="Total Items" value={consolidated.totalItems.toLocaleString()} />
              <StatBox icon={CheckCircle2} label="Counted" value={consolidated.countedItems.toLocaleString()} color="text-emerald-600" />
              <StatBox icon={CheckCircle2} label="Matched" value={consolidated.matchedItems.toLocaleString()} color="text-blue-600" />
              <StatBox icon={AlertTriangle} label="Variances" value={consolidated.varianceItems.toLocaleString()} color="text-amber-600" />
              <StatBox icon={TrendingUp} label="Over" value={`${consolidated.overCount} (${formatCurrency(consolidated.overValue)})`} color="text-red-600" />
              <StatBox icon={TrendingDown} label="Under" value={`${consolidated.underCount} (${formatCurrency(consolidated.underValue)})`} color="text-orange-600" />
              <StatBox icon={Users} label="Teams" value={String(consolidated.teamCount)} />
              <StatBox icon={Users} label="Supervisors" value={String(consolidated.supervisorCount)} />
              <StatBox icon={MessageSquare} label="Open Queries" value={String(consolidated.openQueries)} color={consolidated.openQueries > 0 ? "text-amber-600" : undefined} />
              <StatBox icon={Package} label="Pending Breakdowns" value={String(consolidated.pendingBreakdowns)} color={consolidated.pendingBreakdowns > 0 ? "text-amber-600" : undefined} />
              <StatBox icon={FileWarning} label="Serial Discrepancies" value={String(consolidated.openSerialDiscrepancies)} color={consolidated.openSerialDiscrepancies > 0 ? "text-red-600" : undefined} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Individual event cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {selected.map((event) => (
          <Card
            key={event.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push(`/executive/event/${event.id}`)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{event.name}</CardTitle>
                  {event.location && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {event.location}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={statusColors[event.status] || ""}>
                  {event.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {/* Progress */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-bold">{event.progressPercent}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${event.progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <div className="font-bold text-lg">{Number(event.countedItems).toLocaleString()}</div>
                  <div className="text-muted-foreground text-xs">Counted</div>
                </div>
                <div>
                  <div className="font-bold text-lg text-emerald-600">{Number(event.matchedItems).toLocaleString()}</div>
                  <div className="text-muted-foreground text-xs">Matched</div>
                </div>
                <div>
                  <div className="font-bold text-lg text-amber-600">{Number(event.varianceItems).toLocaleString()}</div>
                  <div className="text-muted-foreground text-xs">Variances</div>
                </div>
              </div>

              {/* Alerts row */}
              {(Number(event.openQueries) > 0 || Number(event.pendingBreakdowns) > 0 || Number(event.openSerialDiscrepancies) > 0) && (
                <div className="flex gap-3 mt-3 pt-3 border-t text-xs text-muted-foreground">
                  {Number(event.openQueries) > 0 && (
                    <span className="text-amber-600">{event.openQueries} open queries</span>
                  )}
                  {Number(event.pendingBreakdowns) > 0 && (
                    <span className="text-amber-600">{event.pendingBreakdowns} pending breakdowns</span>
                  )}
                  {Number(event.openSerialDiscrepancies) > 0 && (
                    <span className="text-red-600">{event.openSerialDiscrepancies} serial issues</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-4 w-4 mt-0.5 ${color || "text-muted-foreground"}`} />
      <div>
        <div className={`font-semibold ${color || ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
