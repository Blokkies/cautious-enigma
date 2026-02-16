"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  AlertTriangle,
  Package,
  DollarSign,
  Users,
  BarChart3,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { groupSerializedVariances } from "@/lib/variance-grouping";

interface DashboardData {
  event: {
    id: number;
    name: string;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    status: string;
  };
  summary: {
    totalItems: number;
    totalCounted: number;
    uncounted: number;
    completionPercent: number;
    matched: number;
    matchPercent: number;
    variances: number;
    totalVarianceValue: number;
    overCount: number;
    overValue: number;
    underCount: number;
    underValue: number;
    netVarianceValue: number;
    totalStockValue: number;
    variancePercent: string;
  };
  teamResults: {
    id: number;
    name: string;
    members: string | null;
    total: number;
    counted: number;
    uncounted: number;
    matched: number;
    variances: number;
    varianceValue: number;
    overCount: number;
    overValue: number;
    underCount: number;
    underValue: number;
    completionPercent: number;
  }[];
  topVariances: {
    itemCode: string;
    description: string | null;
    binNumber: string | null;
    onHand: number | null;
    countedQty: number;
    variance: number | null;
    varianceValue: number | null;
    teamName: string;
    serialNumber?: string | null;
    isSerialized?: boolean | number | null;
  }[];
}

interface EventOption {
  id: number;
  name: string;
  status: string;
}

export default function CompletedDashboard() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(urlEventId || "");
  const isAdmin = user?.type === "admin";

  // Load event list for admin
  useEffect(() => {
    if (!isAdmin) return;
    async function loadEvents() {
      try {
        const res = await fetch("/api/admin/events");
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
        }
      } catch {
        // ignore
      }
    }
    loadEvents();
  }, [isAdmin]);

  // Load dashboard data
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = selectedEventId ? `?eventId=${selectedEventId}` : "";
        const res = await fetch(`/api/completed/dashboard${params}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // error
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedEventId]);

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading dashboard...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No data available
      </div>
    );
  }

  const { event, summary, teamResults, topVariances } = data;

  return (
    <div className="space-y-6 pb-8">
      {/* Event Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-muted-foreground">
            {event.location && `${event.location} · `}
            {event.startDate && event.endDate
              ? `${event.startDate} to ${event.endDate}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && events.length > 1 && (
            <Select value={selectedEventId || String(event.id)} onValueChange={setSelectedEventId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Switch event..." />
              </SelectTrigger>
              <SelectContent>
                {events.map((ev) => (
                  <SelectItem key={ev.id} value={String(ev.id)}>
                    {ev.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge
            className={
              event.status === "completed"
                ? "bg-green-100 text-green-800"
                : event.status === "locked"
                ? "bg-gray-100 text-gray-800"
                : "bg-blue-100 text-blue-800"
            }
          >
            {event.status}
          </Badge>
        </div>
      </div>

      {/* Completion Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Overall Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Completion</span>
              <span className="font-medium">
                {summary.completionPercent}% ({summary.totalCounted.toLocaleString()}{" "}
                / {summary.totalItems.toLocaleString()})
              </span>
            </div>
            <Progress value={summary.completionPercent} className="h-3" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-600" />
              <div className="text-2xl font-bold text-green-700">
                {summary.matched.toLocaleString()}
              </div>
              <div className="text-xs text-green-600">
                Matched ({summary.matchPercent}%)
              </div>
            </div>

            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-amber-600" />
              <div className="text-2xl font-bold text-amber-700">
                {summary.variances.toLocaleString()}
              </div>
              <div className="text-xs text-amber-600">Variances</div>
            </div>

            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <Package className="h-5 w-5 mx-auto mb-1 text-gray-500" />
              <div className="text-2xl font-bold text-gray-700">
                {summary.uncounted.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">Uncounted</div>
            </div>
          </div>

          {/* Variance breakdown */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <TrendingUp className="h-4 w-4 mx-auto mb-1 text-amber-600" />
              <div className="text-lg font-bold text-amber-700">
                R{summary.overValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-amber-600">
                {summary.overCount} items over
              </div>
            </div>

            <div className="text-center p-3 bg-red-50 rounded-lg">
              <TrendingDown className="h-4 w-4 mx-auto mb-1 text-red-600" />
              <div className="text-lg font-bold text-red-700">
                R{summary.underValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-red-600">
                {summary.underCount} items under
              </div>
            </div>

            <div className={`text-center p-3 rounded-lg ${summary.netVarianceValue >= 0 ? "bg-green-50" : "bg-red-50"}`}>
              <DollarSign className={`h-4 w-4 mx-auto mb-1 ${summary.netVarianceValue >= 0 ? "text-green-600" : "text-red-600"}`} />
              <div className={`text-lg font-bold ${summary.netVarianceValue >= 0 ? "text-green-700" : "text-red-700"}`}>
                {summary.netVarianceValue >= 0 ? "" : "-"}R{Math.abs(summary.netVarianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div className={`text-xs ${summary.netVarianceValue >= 0 ? "text-green-600" : "text-red-600"}`}>
                Net ({summary.variancePercent}% of stock)
              </div>
            </div>
          </div>

          <div className="text-center pt-2 border-t text-sm text-muted-foreground">
            Total Stock Value: R{summary.totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </CardContent>
      </Card>

      {/* Team Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Results
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 pb-3 font-medium">Team</th>
                  <th className="px-3 pb-3 font-medium text-right">Items</th>
                  <th className="px-3 pb-3 font-medium text-right">Counted</th>
                  <th className="px-3 pb-3 font-medium text-right">Matched</th>
                  <th className="px-3 pb-3 font-medium text-right">Variances</th>
                  <th className="px-3 pb-3 font-medium text-right">Variance Value</th>
                  <th className="px-3 pb-3 font-medium text-center">Done</th>
                </tr>
              </thead>
              <tbody>
                {teamResults
                  .sort((a, b) => b.completionPercent - a.completionPercent)
                  .map((team) => (
                    <tr key={team.id} className="border-b last:border-b-0">
                      <td className="px-3 py-3">
                        <div className="font-medium">{team.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {(() => { try { return team.members ? (JSON.parse(team.members) as string[]).join(", ") : ""; } catch { return ""; } })()}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{team.total.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{team.counted.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-green-600">
                        {team.matched.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {team.variances > 0 ? (
                          <span className="text-amber-600 font-medium">
                            {team.variances.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-green-600">0</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {team.varianceValue > 0 ? (
                          <div>
                            <span className="text-red-600 font-medium">
                              R{team.varianceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <div className="text-[10px] text-muted-foreground">
                              <span className="text-amber-600">{team.overCount} over</span>
                              {" · "}
                              <span className="text-red-600">{team.underCount} under</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-green-600">R0.00</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Badge
                          variant={team.completionPercent === 100 ? "default" : "secondary"}
                          className={
                            team.completionPercent === 100
                              ? "bg-green-100 text-green-800"
                              : ""
                          }
                        >
                          {team.completionPercent}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top Variances */}
      {topVariances.length > 0 && (
        <TopVariancesTable topVariances={topVariances} />
      )}
    </div>
  );
}

function TopVariancesTable({ topVariances }: { topVariances: DashboardData["topVariances"] }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Adapt items for grouping utility (needs countId, avgCost)
  const groupable = useMemo(() =>
    topVariances.map((v, i) => ({
      ...v,
      countId: -(i + 1), // synthetic ID for grouping
      avgCost: (v.onHand ?? 0) !== 0 && v.varianceValue != null && v.variance != null && v.variance !== 0
        ? v.varianceValue / v.variance
        : 0,
      onHand: v.onHand ?? 0,
      variance: v.variance ?? 0,
      varianceValue: v.varianceValue ?? 0,
      countedQty: v.countedQty,
    })),
    [topVariances]
  );

  const displayRows = useMemo(
    () => groupSerializedVariances(groupable),
    [groupable]
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5" />
          Top Variances (by value)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {displayRows.map((row, rowIdx) => {
            if (row.type === "single") {
              const v = row.item;
              return (
                <div key={rowIdx} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{v.itemCode}</span>
                      {v.serialNumber && (
                        <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono">
                          S/N: {v.serialNumber}
                        </span>
                      )}
                    </div>
                    {v.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{v.description}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {v.binNumber && <span>Bin: {v.binNumber}</span>}
                      <span>{v.onHand} on hand → {v.countedQty} counted</span>
                      <span>{v.teamName}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-red-600">
                      R{Math.abs(v.varianceValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className={`text-xs font-medium ${v.variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                      {v.variance > 0 ? "+" : ""}{v.variance}
                    </span>
                  </div>
                </div>
              );
            }

            // Serialized group
            const groupKey = `${row.itemCode}::${row.binNumber || ""}`;
            const isExpanded = expandedGroups.has(groupKey);

            return (
              <div key={groupKey}>
                <div
                  className="py-3 flex items-start justify-between gap-3 cursor-pointer bg-purple-50/40 hover:bg-purple-50/80 -mx-6 px-6"
                  onClick={() => toggleGroup(groupKey)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-purple-600 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-purple-600 flex-shrink-0" />
                      )}
                      <span className="font-mono text-sm font-medium">{row.itemCode}</span>
                      <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-300 px-1.5 py-0.5 rounded">
                        {row.items.length} serials
                      </span>
                    </div>
                    {row.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5 ml-6">{row.description}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground ml-6">
                      {row.binNumber && <span>Bin: {row.binNumber}</span>}
                      <span>{row.totalOnHand} on hand → {row.totalCounted} counted</span>
                      <span>{row.teamName}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-red-600">
                      R{Math.abs(row.totalVarianceValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className={`text-xs font-medium ${row.totalVariance < 0 ? "text-red-600" : "text-amber-600"}`}>
                      {row.totalVariance > 0 ? "+" : ""}{row.totalVariance}
                    </span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="ml-6 divide-y">
                    {row.items.map((v, subIdx) => (
                      <div key={`${groupKey}-${subIdx}`} className="py-2 flex items-center justify-between gap-3 pl-4">
                        <div className="flex items-center gap-2 min-w-0">
                          {v.serialNumber ? (
                            <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded font-mono">
                              S/N: {v.serialNumber}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No S/N</span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {v.countedQty > 0 ? "Found" : "Not found"}
                          </span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`text-xs font-medium ${v.variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                            {v.variance > 0 ? "+" : ""}{v.variance}
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">
                            R{Math.abs(v.varianceValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
