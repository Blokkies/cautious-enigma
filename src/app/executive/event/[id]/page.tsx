"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  FileWarning,
  MapPin,
  Clock,
} from "lucide-react";

interface Overall {
  total: number;
  counted: number;
  matched: number;
  withVariance: number;
  varianceValue: number;
  overCount: number;
  overValue: number;
  underCount: number;
  underValue: number;
  netVarianceValue: number;
  pending: number;
  progressPercent: number;
  openQueries: number;
  pendingBreakdowns: number;
  openSerialDiscrepancies: number;
}

interface TeamProgress {
  id: number;
  name: string;
  members: string | null;
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
  isMatch: boolean;
  countedAt: string;
}

interface EventInfo {
  id: number;
  name: string;
  location: string | null;
  status: string;
  startDate: string | null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value);
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  completed: "bg-blue-500/10 text-blue-700 border-blue-500/20",
};

export default function EventDrillDown() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [overall, setOverall] = useState<Overall | null>(null);
  const [teamProgress, setTeamProgress] = useState<TeamProgress[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/executive/event/${id}`);
      if (res.ok) {
        const data = await res.json();
        setEvent(data.event);
        setOverall(data.overall);
        setTeamProgress(data.teamProgress || []);
        setRecentActivity(data.recentActivity || []);
      }
    } catch {
      // network error
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading event data...</div>;
  }

  if (!event || !overall) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Event not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/executive")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => router.push("/executive")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <Badge variant="outline" className={statusColors[event.status] || ""}>
              {event.status}
            </Badge>
          </div>
          {event.location && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {event.location}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Overall Progress</span>
            <span className="font-bold text-lg">{overall.progressPercent}%</span>
          </div>
          <div className="h-4 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${overall.progressPercent}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm">
            <div>
              <div className="font-bold text-xl">{Number(overall.counted).toLocaleString()}</div>
              <div className="text-muted-foreground">of {Number(overall.total).toLocaleString()} counted</div>
            </div>
            <div>
              <div className="font-bold text-xl text-emerald-600">{Number(overall.matched).toLocaleString()}</div>
              <div className="text-muted-foreground">matched</div>
            </div>
            <div>
              <div className="font-bold text-xl text-amber-600">{Number(overall.withVariance).toLocaleString()}</div>
              <div className="text-muted-foreground">variances</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Over" value={`${overall.overCount}`} sub={formatCurrency(overall.overValue)} color="text-red-600" />
        <StatCard icon={TrendingDown} label="Under" value={`${overall.underCount}`} sub={formatCurrency(overall.underValue)} color="text-orange-600" />
        <StatCard icon={MessageSquare} label="Open Queries" value={`${overall.openQueries}`} color={overall.openQueries > 0 ? "text-amber-600" : undefined} />
        <StatCard icon={FileWarning} label="Serial Issues" value={`${overall.openSerialDiscrepancies}`} color={overall.openSerialDiscrepancies > 0 ? "text-red-600" : undefined} />
      </div>

      {/* Team progress */}
      <Card>
        <CardHeader>
          <CardTitle>Team Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {teamProgress.length === 0 && (
            <p className="text-sm text-muted-foreground">No teams assigned.</p>
          )}
          {teamProgress.map((team) => (
            <div key={team.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium">{team.name}</span>
                  {team.members && (() => {
                    try {
                      const m = JSON.parse(team.members) as string[];
                      return m.length > 0 ? <span className="text-sm text-muted-foreground ml-2">({m.join(", ")})</span> : null;
                    } catch { return null; }
                  })()}
                </div>
                <div className="text-sm font-bold">{team.progressPercent}%</div>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${team.progressPercent}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{Number(team.counted).toLocaleString()} / {Number(team.total).toLocaleString()} counted</span>
                {Number(team.variances) > 0 && (
                  <span className="text-amber-600">{team.variances} variances</span>
                )}
                {team.lastActivity && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeAgo(team.lastActivity)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recentActivity.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div className="flex items-center gap-2">
                    {a.isMatch ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    <span className="font-mono text-xs">{a.itemCode}</span>
                    <span className="text-muted-foreground">by {a.teamName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>Qty: {a.countedQty}</span>
                    {!a.isMatch && (
                      <span className="text-amber-600 text-xs">var: {Number(a.variance) > 0 ? "+" : ""}{a.variance}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{timeAgo(a.countedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color || "text-muted-foreground"}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className={`text-2xl font-bold mt-1 ${color || ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
