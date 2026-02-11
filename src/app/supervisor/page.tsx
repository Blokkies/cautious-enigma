"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  MessageSquare,
  Package,
  Activity,
  ScanBarcode,
} from "lucide-react";

interface OverallStats {
  total: number;
  counted: number;
  matched: number;
  withVariance: number;
  varianceValue: number;
  pending: number;
  progressPercent: number;
  openQueries: number;
  pendingBreakdowns: number;
  openSerialDiscrepancies: number;
}

interface TeamProgress {
  id: number;
  name: string;
  member1: string | null;
  member2: string | null;
  total: number;
  counted: number;
  pending: number;
  variances: number;
  progressPercent: number;
  lastActivity: string | null;
}

interface RecentActivity {
  teamName: string;
  itemCode: string;
  countedQty: number;
  variance: number;
  isMatch: boolean | number;
  countedAt: string;
}

export default function SupervisorDashboard() {
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [teamProgress, setTeamProgress] = useState<TeamProgress[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/dashboard");
      if (res.ok) {
        const data = await res.json();
        setOverall(data.overall);
        setTeamProgress(data.teamProgress);
        setRecentActivity(data.recentActivity);
      }
    } catch {
      // will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, [loadDashboard]);

  if (loading || !overall) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Supervisor Dashboard</h1>

      {/* Overall Progress */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center mb-4">
            <div className="text-5xl font-bold text-primary">
              {overall.progressPercent}%
            </div>
            <div className="text-muted-foreground">Overall Progress</div>
          </div>
          <Progress value={overall.progressPercent} className="h-4 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-green-600">
                {overall.matched}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Matched
              </div>
            </div>
            <div>
              <div className="text-xl font-bold text-amber-600">
                {overall.withVariance}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Variance
              </div>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-500">
                {overall.pending}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="h-3 w-3" />
                Pending
              </div>
            </div>
            <div>
              <div className="text-xl font-bold text-red-600">
                R{overall.varianceValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
              </div>
              <div className="text-xs text-muted-foreground">
                Variance Value
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts Row */}
      <div className="grid grid-cols-3 gap-3">
        <Card
          className={
            overall.openQueries > 0
              ? "border-amber-300 bg-amber-50"
              : ""
          }
        >
          <CardContent className="pt-4 text-center">
            <MessageSquare className="h-6 w-6 mx-auto mb-1 text-amber-600" />
            <div className="text-2xl font-bold">{overall.openQueries}</div>
            <div className="text-xs text-muted-foreground">Open Queries</div>
          </CardContent>
        </Card>
        <Card
          className={
            overall.pendingBreakdowns > 0
              ? "border-amber-300 bg-amber-50"
              : ""
          }
        >
          <CardContent className="pt-4 text-center">
            <Package className="h-6 w-6 mx-auto mb-1 text-amber-600" />
            <div className="text-2xl font-bold">
              {overall.pendingBreakdowns}
            </div>
            <div className="text-xs text-muted-foreground">
              Pending Breakdowns
            </div>
          </CardContent>
        </Card>
        <Card
          className={
            overall.openSerialDiscrepancies > 0
              ? "border-purple-300 bg-purple-50"
              : ""
          }
        >
          <CardContent className="pt-4 text-center">
            <ScanBarcode className="h-6 w-6 mx-auto mb-1 text-purple-600" />
            <div className="text-2xl font-bold">
              {overall.openSerialDiscrepancies}
            </div>
            <div className="text-xs text-muted-foreground">
              Serial Discrepancies
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Progress Cards */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Team Progress</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {teamProgress
            .sort((a, b) => b.progressPercent - a.progressPercent)
            .map((team) => (
              <Card key={team.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-semibold">{team.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[team.member1, team.member2]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {team.progressPercent}%
                    </div>
                  </div>
                  <Progress
                    value={team.progressPercent}
                    className="h-2 mb-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {team.counted}/{team.total} counted
                    </span>
                    {team.variances > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-400 text-amber-700"
                      >
                        {team.variances} variances
                      </Badge>
                    )}
                    {team.lastActivity && (
                      <span>
                        Last:{" "}
                        {new Date(team.lastActivity).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentActivity.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No activity yet
              </p>
            ) : (
              recentActivity.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1 text-sm border-b last:border-0"
                >
                  <div className="flex items-center gap-2">
                    {a.isMatch === true || a.isMatch === 1 ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                    )}
                    <span className="font-medium">{a.teamName}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {a.itemCode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {a.variance !== 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-400 text-amber-700"
                      >
                        {a.variance > 0 ? "+" : ""}
                        {a.variance}
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {new Date(a.countedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
