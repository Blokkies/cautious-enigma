"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Package,
  CheckCircle2,
  Clock,
  Minus,
} from "lucide-react";

interface BinProgress {
  binNumber: string;
  totalItems: number;
  countedItems: number;
  isComplete: boolean;
}

interface TeamProgress {
  id: number;
  name: string;
  members: string | null;
  bins: BinProgress[];
  totalBins: number;
  completedBins: number;
}

export default function BinProgressPage() {
  const [teams, setTeams] = useState<TeamProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/bin-progress");
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleTeam = (teamId: number) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const filteredTeams = useMemo(() => {
    if (!search.trim()) return teams;
    const q = search.toLowerCase();
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.members && t.members.toLowerCase().includes(q))
    );
  }, [teams, search]);

  // Overall stats
  const totalBins = teams.reduce((s, t) => s + t.totalBins, 0);
  const completedBins = teams.reduce((s, t) => s + t.completedBins, 0);
  const overallPercent = totalBins > 0 ? Math.round((completedBins / totalBins) * 100) : 0;

  const parseMembers = (members: string | null): string => {
    if (!members) return "";
    try {
      const arr = JSON.parse(members) as string[];
      return arr.join(", ");
    } catch {
      return "";
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Bin Progress</h1>

      {/* Overall stats */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Bin Completion</span>
            <span className="text-sm text-muted-foreground">
              {completedBins}/{totalBins} bins ({overallPercent}%)
            </span>
          </div>
          <Progress value={overallPercent} className="h-3 mb-2" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{teams.length} teams</span>
            <span>{totalBins} total bins</span>
            <span className="text-green-600">{completedBins} complete</span>
            <span className="text-amber-600">{totalBins - completedBins} remaining</span>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search teams..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Team cards */}
      <div className="space-y-3">
        {filteredTeams.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {search ? "No teams match your search" : "No teams with assigned bins"}
          </div>
        ) : (
          filteredTeams.map((team) => {
            const isExpanded = expandedTeams.has(team.id);
            const percent = team.totalBins > 0
              ? Math.round((team.completedBins / team.totalBins) * 100)
              : 0;
            const membersStr = parseMembers(team.members);

            return (
              <Card key={team.id}>
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleTeam(team.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <span className="font-semibold">{team.name}</span>
                        {membersStr && (
                          <span className="text-sm text-muted-foreground ml-2">
                            ({membersStr})
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={percent === 100 ? "default" : "secondary"}
                      className={percent === 100 ? "bg-green-100 text-green-800" : ""}
                    >
                      {team.completedBins}/{team.totalBins} bins
                    </Badge>
                  </div>
                  <Progress value={percent} className="h-2" />
                  <div className="text-xs text-muted-foreground mt-1">
                    {percent}% complete
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="border-t pt-3 pb-3 space-y-1 max-h-72 overflow-y-auto">
                    {team.bins.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        No bins assigned
                      </div>
                    ) : (
                      team.bins.map((bin) => {
                        const binPercent = bin.totalItems > 0
                          ? Math.round((bin.countedItems / bin.totalItems) * 100)
                          : 0;

                        let statusIcon;
                        let statusColor;
                        if (bin.isComplete) {
                          statusIcon = <CheckCircle2 className="h-4 w-4 text-green-600" />;
                          statusColor = "bg-green-50 border-green-200";
                        } else if (bin.countedItems > 0) {
                          statusIcon = <Clock className="h-4 w-4 text-amber-500" />;
                          statusColor = "bg-amber-50 border-amber-200";
                        } else {
                          statusIcon = <Minus className="h-4 w-4 text-gray-400" />;
                          statusColor = "bg-gray-50 border-gray-200";
                        }

                        return (
                          <div
                            key={bin.binNumber}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg border ${statusColor}`}
                          >
                            <div className="flex items-center gap-2">
                              {statusIcon}
                              <Package className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-mono text-sm">{bin.binNumber}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {bin.countedItems}/{bin.totalItems} items
                              </span>
                              <Badge
                                variant="outline"
                                className={
                                  bin.isComplete
                                    ? "bg-green-100 text-green-700 border-green-300"
                                    : bin.countedItems > 0
                                      ? "bg-amber-100 text-amber-700 border-amber-300"
                                      : "bg-gray-100 text-gray-500 border-gray-300"
                                }
                              >
                                {binPercent}%
                              </Badge>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
