"use client";

import { useState, useEffect } from "react";
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
  TrendingDown,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

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
    totalStockValue: number;
    variancePercent: string;
  };
  teamResults: {
    id: number;
    name: string;
    member1: string | null;
    member2: string | null;
    total: number;
    counted: number;
    uncounted: number;
    matched: number;
    variances: number;
    varianceValue: number;
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

            <div className="text-center p-3 bg-red-50 rounded-lg">
              <DollarSign className="h-5 w-5 mx-auto mb-1 text-red-600" />
              <div className="text-2xl font-bold text-red-700">
                R{summary.totalVarianceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-red-600">
                Variance Value ({summary.variancePercent}% of stock)
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 font-medium text-center">Items</th>
                  <th className="pb-2 font-medium text-center">Counted</th>
                  <th className="pb-2 font-medium text-center">Matched</th>
                  <th className="pb-2 font-medium text-center">Variances</th>
                  <th className="pb-2 font-medium text-right">Variance Value</th>
                  <th className="pb-2 font-medium text-center">Done</th>
                </tr>
              </thead>
              <tbody>
                {teamResults
                  .sort((a, b) => b.completionPercent - a.completionPercent)
                  .map((team) => (
                    <tr key={team.id} className="border-b last:border-b-0">
                      <td className="py-2">
                        <div className="font-medium">{team.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[team.member1, team.member2]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      </td>
                      <td className="py-2 text-center">{team.total.toLocaleString()}</td>
                      <td className="py-2 text-center">{team.counted.toLocaleString()}</td>
                      <td className="py-2 text-center text-green-600">
                        {team.matched.toLocaleString()}
                      </td>
                      <td className="py-2 text-center">
                        {team.variances > 0 ? (
                          <span className="text-amber-600 font-medium">
                            {team.variances.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-green-600">0</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {team.varianceValue > 0 ? (
                          <span className="text-red-600">
                            R{team.varianceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-green-600">R0.00</span>
                        )}
                      </td>
                      <td className="py-2 text-center">
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              Top Variances (by value)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">Item Code</th>
                    <th className="pb-2 font-medium hidden md:table-cell">Description</th>
                    <th className="pb-2 font-medium">Bin</th>
                    <th className="pb-2 font-medium text-center">On Hand</th>
                    <th className="pb-2 font-medium text-center">Counted</th>
                    <th className="pb-2 font-medium text-center">Variance</th>
                    <th className="pb-2 font-medium text-right">Value</th>
                    <th className="pb-2 font-medium hidden md:table-cell">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {topVariances.map((v, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="py-2 font-mono text-xs">{v.itemCode}</td>
                      <td className="py-2 hidden md:table-cell text-xs truncate max-w-[200px]">
                        {v.description}
                      </td>
                      <td className="py-2 text-xs">{v.binNumber}</td>
                      <td className="py-2 text-center">{v.onHand}</td>
                      <td className="py-2 text-center">{v.countedQty}</td>
                      <td className="py-2 text-center">
                        <span
                          className={
                            (v.variance || 0) < 0
                              ? "text-red-600 font-medium"
                              : "text-amber-600 font-medium"
                          }
                        >
                          {(v.variance || 0) > 0 ? "+" : ""}
                          {v.variance}
                        </span>
                      </td>
                      <td className="py-2 text-right text-red-600 font-medium">
                        R{Math.abs(v.varianceValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 hidden md:table-cell text-xs">
                        {v.teamName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
