"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  Users,
  MessageSquare,
  FileWarning,
  MapPin,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

const EVENT_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-indigo-500",
];

export default function ExecutiveDashboard() {
  const router = useRouter();
  const [events, setEvents] = useState<EventStats[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const initialLoadDone = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/executive/dashboard");
      if (res.ok) {
        const data = await res.json();
        const eventList: EventStats[] = data.events || [];
        setEvents(eventList);
        // Only auto-select on first load
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          setSelectedIds(new Set(eventList.filter((e) => e.status === "active").map((e) => e.id)));
        }
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

  const selectAll = () => setSelectedIds(new Set(events.map((e) => e.id)));
  const selectNone = () => setSelectedIds(new Set());

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

      {/* Event selector - toggle chips */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Events
          </span>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-primary hover:underline">Select all</button>
            <span className="text-xs text-muted-foreground">|</span>
            <button onClick={selectNone} className="text-xs text-primary hover:underline">Clear</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {events.map((event) => {
            const isSelected = selectedIds.has(event.id);
            return (
              <button
                key={event.id}
                onClick={() => toggleEvent(event.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-muted bg-background hover:border-muted-foreground/30 opacity-60"
                )}
              >
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  event.status === "active" ? "bg-emerald-500" : "bg-blue-500"
                )} />
                <span className={cn("font-medium", isSelected ? "text-foreground" : "text-muted-foreground")}>
                  {event.name}
                </span>
                {event.location && (
                  <span className="text-muted-foreground text-xs hidden sm:inline">
                    {event.location}
                  </span>
                )}
                <span className={cn(
                  "text-xs font-mono tabular-nums",
                  isSelected ? "text-primary" : "text-muted-foreground"
                )}>
                  {event.progressPercent}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Consolidated summary (shown when events selected) */}
      {selected.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selected.length === 1 ? selected[0].name : `Consolidated Summary`}
              {selected.length > 1 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {selected.length} events
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">Overall Progress</span>
                <span className="font-bold text-lg">{consolidatedProgress}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${consolidatedProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                <span>{consolidated.countedItems.toLocaleString()} of {consolidated.totalItems.toLocaleString()} items counted</span>
                <span>{(consolidated.totalItems - consolidated.countedItems).toLocaleString()} remaining</span>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <MetricCard label="Matched" value={consolidated.matchedItems.toLocaleString()} color="text-emerald-600" bgColor="bg-emerald-500/10" />
              <MetricCard label="Variances" value={consolidated.varianceItems.toLocaleString()} sub={formatCurrency(consolidated.varianceValue)} color="text-amber-600" bgColor="bg-amber-500/10" />
              <MetricCard
                label="Over"
                value={consolidated.overCount.toLocaleString()}
                sub={formatCurrency(consolidated.overValue)}
                color="text-red-600"
                bgColor="bg-red-500/10"
              />
              <MetricCard
                label="Under"
                value={consolidated.underCount.toLocaleString()}
                sub={formatCurrency(consolidated.underValue)}
                color="text-orange-600"
                bgColor="bg-orange-500/10"
              />
            </div>

            {/* Operational stats */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <MiniStat icon={Users} label="Teams" value={consolidated.teamCount} />
              <MiniStat icon={Users} label="Supervisors" value={consolidated.supervisorCount} />
              <MiniStat icon={MessageSquare} label="Open Queries" value={consolidated.openQueries} alert={consolidated.openQueries > 0} />
              <MiniStat icon={Package} label="Breakdowns" value={consolidated.pendingBreakdowns} alert={consolidated.pendingBreakdowns > 0} />
              <MiniStat icon={FileWarning} label="Serial Issues" value={consolidated.openSerialDiscrepancies} alert={consolidated.openSerialDiscrepancies > 0} />
            </div>

            {/* Event breakdown (expandable, only for multi-event) */}
            {selected.length > 1 && (
              <div className="border-t pt-4">
                <button
                  onClick={() => setShowBreakdown(!showBreakdown)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  <BarChart3 className="h-4 w-4" />
                  Event Breakdown
                  {showBreakdown ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                </button>

                {showBreakdown && (
                  <div className="mt-4 space-y-4">
                    {/* Stacked progress bars */}
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Items Contribution</div>
                      <div className="h-6 bg-muted rounded-full overflow-hidden flex">
                        {selected.map((event, i) => {
                          const pct = consolidated.totalItems > 0
                            ? (Number(event.totalItems) / consolidated.totalItems) * 100
                            : 0;
                          if (pct === 0) return null;
                          return (
                            <div
                              key={event.id}
                              className={cn("h-full transition-all relative group", EVENT_COLORS[i % EVENT_COLORS.length])}
                              style={{ width: `${pct}%` }}
                              title={`${event.name}: ${Number(event.totalItems).toLocaleString()} items (${Math.round(pct)}%)`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        {selected.map((event, i) => (
                          <div key={event.id} className="flex items-center gap-1.5 text-xs">
                            <div className={cn("h-2.5 w-2.5 rounded-sm", EVENT_COLORS[i % EVENT_COLORS.length])} />
                            <span className="text-muted-foreground">{event.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Detailed table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">Event</th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Items</th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Progress</th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Matched</th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Variances</th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Var. Value</th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">Issues</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selected.map((event, i) => {
                            const totalIssues = Number(event.openQueries) + Number(event.pendingBreakdowns) + Number(event.openSerialDiscrepancies);
                            return (
                              <tr key={event.id} className="hover:bg-muted/50">
                                <td className="py-2.5 pr-4">
                                  <div className="flex items-center gap-2">
                                    <div className={cn("h-2.5 w-2.5 rounded-sm shrink-0", EVENT_COLORS[i % EVENT_COLORS.length])} />
                                    <span className="font-medium">{event.name}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 pr-4 text-right tabular-nums">
                                  {Number(event.totalItems).toLocaleString()}
                                  {consolidated.totalItems > 0 && (
                                    <span className="text-muted-foreground text-xs ml-1">
                                      ({Math.round((Number(event.totalItems) / consolidated.totalItems) * 100)}%)
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 pr-4 text-right">
                                  <div className="flex items-center gap-2 justify-end">
                                    <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-primary rounded-full"
                                        style={{ width: `${event.progressPercent}%` }}
                                      />
                                    </div>
                                    <span className="tabular-nums text-xs w-8">{event.progressPercent}%</span>
                                  </div>
                                </td>
                                <td className="py-2.5 pr-4 text-right tabular-nums text-emerald-600">
                                  {Number(event.matchedItems).toLocaleString()}
                                </td>
                                <td className="py-2.5 pr-4 text-right tabular-nums text-amber-600">
                                  {Number(event.varianceItems).toLocaleString()}
                                </td>
                                <td className="py-2.5 pr-4 text-right tabular-nums">
                                  {formatCurrency(Number(event.varianceValue))}
                                </td>
                                <td className={cn("py-2.5 text-right tabular-nums", totalIssues > 0 ? "text-red-600" : "text-muted-foreground")}>
                                  {totalIssues}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Totals row */}
                          <tr className="font-semibold border-t-2">
                            <td className="py-2.5 pr-4">Total</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">{consolidated.totalItems.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">{consolidatedProgress}%</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums text-emerald-600">{consolidated.matchedItems.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums text-amber-600">{consolidated.varianceItems.toLocaleString()}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums">{formatCurrency(consolidated.varianceValue)}</td>
                            <td className="py-2.5 text-right tabular-nums">
                              {consolidated.openQueries + consolidated.pendingBreakdowns + consolidated.openSerialDiscrepancies}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Individual event cards */}
      {selected.length > 0 && (
        <>
          {selected.length > 1 && (
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Event Details
            </h2>
          )}
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
        </>
      )}

      {selected.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Select one or more events above to view the dashboard.</p>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  color,
  bgColor,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className={cn("rounded-lg p-3", bgColor)}>
      <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
      {sub && <div className={cn("text-xs font-medium", color)}>{sub}</div>}
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className={cn("h-3.5 w-3.5", alert ? "text-amber-600" : "text-muted-foreground")} />
      <div className="min-w-0">
        <div className={cn("text-sm font-semibold tabular-nums leading-tight", alert ? "text-amber-600" : "")}>{value}</div>
        <div className="text-[10px] text-muted-foreground leading-tight truncate">{label}</div>
      </div>
    </div>
  );
}
