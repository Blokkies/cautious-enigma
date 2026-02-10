"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
} from "lucide-react";

interface TeamStats {
  total: number;
  counted: number;
  matched: number;
  withVariance: number;
  pending: number;
  progressPercent: number;
}

export default function TeamDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<TeamStats>({
    total: 0,
    counted: 0,
    matched: 0,
    withVariance: 0,
    pending: 0,
    progressPercent: 0,
  });
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/team/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // Offline or error - stats will update when back online
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, [loadStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Progress Section */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center mb-4">
            <div className="text-4xl font-bold text-primary">
              {stats.progressPercent}%
            </div>
            <div className="text-muted-foreground">Complete</div>
          </div>
          <Progress value={stats.progressPercent} className="h-4 mb-4" />
          <div className="text-center text-sm text-muted-foreground">
            {stats.counted} of {stats.total} items counted
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4 text-center">
            <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-1" />
            <div className="text-2xl font-bold text-green-700">
              {stats.matched}
            </div>
            <div className="text-xs text-green-600">Matched</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-center">
            <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto mb-1" />
            <div className="text-2xl font-bold text-amber-700">
              {stats.withVariance}
            </div>
            <div className="text-xs text-amber-600">Variance</div>
          </CardContent>
        </Card>
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="pt-4 text-center">
            <Clock className="h-6 w-6 text-gray-500 mx-auto mb-1" />
            <div className="text-2xl font-bold text-gray-700">
              {stats.pending}
            </div>
            <div className="text-xs text-gray-500">Pending</div>
          </CardContent>
        </Card>
      </div>

      {/* Continue Counting Button */}
      <Button
        onClick={() => router.push("/team/count")}
        className="w-full h-16 text-xl gap-2"
        size="lg"
      >
        Continue Counting
        <ArrowRight className="h-6 w-6" />
      </Button>
    </div>
  );
}
