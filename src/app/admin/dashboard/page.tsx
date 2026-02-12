"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  MessageSquare,
  Package,
  ScanBarcode,
  UserCheck,
} from "lucide-react";

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
  progressPercent: number;
  teamCount: number;
  supervisorCount: number;
  openQueries: number;
  pendingBreakdowns: number;
  openSerialDiscrepancies: number;
}

export default function AdminDashboard() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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
    const interval = setInterval(loadDashboard, 10000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  // Sort: active first (by progress ascending), then completed
  const sorted = [...events].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return a.progressPercent - b.progressPercent;
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Executive Dashboard</h1>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No active events
          </CardContent>
        </Card>
      ) : (
        sorted.map((event) => (
          <Card
            key={event.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => router.push(`/admin/summary?eventId=${event.id}`)}
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
                <Badge
                  variant={
                    event.status === "active" ? "default" : "secondary"
                  }
                  className={
                    event.status === "active"
                      ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                      : "bg-green-100 text-green-800 hover:bg-green-100"
                  }
                >
                  {event.status === "active" ? "Active" : "Completed"}
                </Badge>
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

              {/* 4-col stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center mb-4">
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
                <div>
                  <div className="text-xl font-bold text-red-600">
                    R
                    {event.varianceValue.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Variance Value
                  </div>
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
