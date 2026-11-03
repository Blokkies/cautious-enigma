"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  Wallet,
  Scale,
  BarChart3,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { groupSerializedVariances } from "@/lib/variance-grouping";
import { formatDateRange, formatMoney, formatNumber, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/admin/stat-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { LoadingState } from "@/components/admin/loading-state";
import { EmptyState } from "@/components/admin/empty-state";
import { PanelSection } from "@/components/admin/panels/panel-section";

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

/**
 * Results for one event. `eventId` pins the event (admin event workspace) and hides the
 * event picker; without it the event comes from ?eventId= (or the default event).
 */
export function CompletedDashboardContent({ eventId }: { eventId?: string } = {}) {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const pinned = !!eventId;
  const urlEventId = eventId ?? searchParams.get("eventId");

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
    return <LoadingState label="Loading results…" />;
  }

  if (!data) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No results available"
        description="There is no count data for this stocktake yet."
      />
    );
  }

  const { event, summary, teamResults, topVariances } = data;
  const dates = formatDateRange(event.startDate, event.endDate);
  const net = summary.netVarianceValue;

  return (
    <div className="space-y-6 pb-8">
      {/* Event header (the admin workspace shows its own header when pinned) */}
      {!pinned && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              <span className="break-words">{event.name}</span>
              <StatusBadge status={event.status} />
            </h1>
            {(event.location || dates) && (
              <p className="text-sm text-slate-500">{[event.location, dates].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          {isAdmin && !pinned && events.length > 1 && (
            <Select
              value={selectedEventId || String(event.id)}
              onValueChange={(v) => {
                setSelectedEventId(v);
                // Keep ?eventId= in the URL so the layout's Export link targets this event
                const url = new URL(window.location.href);
                url.searchParams.set("eventId", v);
                window.history.replaceState(null, "", url);
              }}
            >
              <SelectTrigger className="w-full bg-white sm:w-56" aria-label="Switch event">
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
        </header>
      )}

      {/* Overall summary */}
      <section className="space-y-3" aria-labelledby="results-summary-heading">
        <h2 id="results-summary-heading" className="text-base font-semibold text-slate-900">
          Overall summary
        </h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
              {summary.completionPercent}%
            </span>
            <span className="text-sm tabular-nums text-slate-500">
              {formatNumber(summary.totalCounted)} of {plural(summary.totalItems, "item")} counted
            </span>
          </div>
          <Progress value={summary.completionPercent} className="mt-3 h-2" aria-label={`${summary.completionPercent}% counted`} />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Matched"
            value={formatNumber(summary.matched)}
            hint={`${summary.matchPercent}% of counted items`}
            icon={CheckCircle2}
            tone="positive"
          />
          <StatCard
            label="Variances"
            value={formatNumber(summary.variances)}
            icon={AlertTriangle}
            tone={summary.variances > 0 ? "warning" : "default"}
          />
          <StatCard label="Uncounted" value={formatNumber(summary.uncounted)} icon={Package} />
          <StatCard
            label="Total stock value"
            value={formatMoney(summary.totalStockValue, { decimals: 0 })}
            hint={formatMoney(summary.totalStockValue)}
            icon={Wallet}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Over (surplus)"
            value={formatMoney(summary.overValue, { decimals: 0 })}
            hint={`${plural(summary.overCount, "item")} over`}
            icon={TrendingUp}
            tone={summary.overCount > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Under (shortage)"
            value={formatMoney(summary.underValue, { decimals: 0 })}
            hint={`${plural(summary.underCount, "item")} under`}
            icon={TrendingDown}
            tone={summary.underCount > 0 ? "negative" : "default"}
          />
          <StatCard
            label="Net variance"
            value={formatMoney(net, { decimals: 0, signed: true })}
            hint={`${summary.variancePercent}% of stock value`}
            icon={Scale}
            tone={net < 0 ? "negative" : net > 0 ? "warning" : "default"}
          />
        </div>
      </section>

      {/* Team results */}
      <PanelSection title="Team results" bodyClassName="p-0 sm:p-0 pt-3 sm:pt-3">
        {teamResults.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-slate-500 sm:px-5">No teams in this stocktake.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/60 text-left text-xs font-medium text-slate-500">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:pl-5">Team</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Items</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Counted</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Matched</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Variances</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-medium">Variance value</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right font-medium sm:pr-5">Done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamResults
                  .sort((a, b) => b.completionPercent - a.completionPercent)
                  .map((team) => (
                    <tr key={team.id}>
                      <td className="px-4 py-3 sm:pl-5">
                        <div className="font-medium text-slate-900">{team.name}</div>
                        <div className="text-xs text-slate-500">
                          {(() => { try { return team.members ? (JSON.parse(team.members) as string[]).join(", ") : ""; } catch { return ""; } })()}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{formatNumber(team.total)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{formatNumber(team.counted)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-emerald-700">{formatNumber(team.matched)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {team.variances > 0 ? (
                          <span className="font-medium text-amber-700">{formatNumber(team.variances)}</span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {team.varianceValue > 0 ? (
                          <div>
                            <span className="font-medium text-red-700">{formatMoney(team.varianceValue)}</span>
                            <div className="text-[11px] text-slate-500">
                              <span className="text-amber-700">{formatNumber(team.overCount)} over</span>
                              {" · "}
                              <span className="text-red-700">{formatNumber(team.underCount)} under</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">{formatMoney(0)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right sm:pr-5">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset",
                            team.completionPercent === 100
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : "bg-slate-50 text-slate-700 ring-slate-200"
                          )}
                        >
                          {team.completionPercent}%
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelSection>

      {/* Top variances */}
      {topVariances.length > 0 && (
        <TopVariancesTable topVariances={topVariances} />
      )}
    </div>
  );
}

function SignedQty({ value }: { value: number }) {
  return (
    <span className={cn("text-xs font-medium tabular-nums", value < 0 ? "text-red-700" : "text-amber-700")}>
      {value > 0 ? "+" : ""}
      {formatNumber(value, Number.isInteger(value) ? 0 : 2)}
    </span>
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
    <PanelSection
      title="Top variances"
      description="The largest differences by value."
      bodyClassName="px-0 pb-1 pt-2 sm:px-0 sm:pb-1 sm:pt-2"
    >
      <div className="divide-y divide-slate-100 border-t border-slate-200">
        {displayRows.map((row, rowIdx) => {
          if (row.type === "single") {
            const v = row.item;
            return (
              <div key={rowIdx} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-sm font-medium text-slate-900">{v.itemCode}</span>
                    {v.serialNumber && (
                      <span className="break-all rounded bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] text-purple-700">
                        S/N: {v.serialNumber}
                      </span>
                    )}
                  </div>
                  {v.description && (
                    <div className="mt-0.5 truncate text-xs text-slate-500">{v.description}</div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {v.binNumber && <span>Bin: {v.binNumber}</span>}
                    <span className="tabular-nums">{v.onHand} on hand → {v.countedQty} counted</span>
                    <span>{v.teamName}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-red-700">
                    {formatMoney(Math.abs(v.varianceValue))}
                  </div>
                  <SignedQty value={v.variance} />
                </div>
              </div>
            );
          }

          // Serialized group
          const groupKey = `${row.itemCode}::${row.binNumber || ""}`;
          const isExpanded = expandedGroups.has(groupKey);

          return (
            <div key={groupKey}>
              <button
                type="button"
                aria-expanded={isExpanded}
                className="flex w-full items-start justify-between gap-3 bg-purple-50/40 px-4 py-3 text-left transition-colors hover:bg-purple-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                onClick={() => toggleGroup(groupKey)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-purple-600" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-purple-600" aria-hidden="true" />
                    )}
                    <span className="break-all font-mono text-sm font-medium text-slate-900">{row.itemCode}</span>
                    <span className="rounded border border-purple-300 bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-800">
                      {plural(row.items.length, "serial")}
                    </span>
                  </div>
                  {row.description && (
                    <div className="ml-6 mt-0.5 truncate text-xs text-slate-500">{row.description}</div>
                  )}
                  <div className="ml-6 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {row.binNumber && <span>Bin: {row.binNumber}</span>}
                    <span className="tabular-nums">{row.totalOnHand} on hand → {row.totalCounted} counted</span>
                    <span>{row.teamName}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-red-700">
                    {formatMoney(Math.abs(row.totalVarianceValue))}
                  </div>
                  <SignedQty value={row.totalVariance} />
                </div>
              </button>
              {isExpanded && (
                <div className="ml-6 divide-y divide-slate-100">
                  {row.items.map((v, subIdx) => (
                    <div key={`${groupKey}-${subIdx}`} className="flex items-center justify-between gap-3 py-2 pl-4 pr-4 sm:pr-5">
                      <div className="flex min-w-0 items-center gap-2">
                        {v.serialNumber ? (
                          <span className="break-all rounded bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] text-purple-700">
                            S/N: {v.serialNumber}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">No S/N</span>
                        )}
                        <span className="text-xs text-slate-500">
                          {v.countedQty > 0 ? "Found" : "Not found"}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <SignedQty value={v.variance} />
                        <span className="ml-2 text-xs tabular-nums text-slate-500">
                          {formatMoney(Math.abs(v.varianceValue))}
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
    </PanelSection>
  );
}
