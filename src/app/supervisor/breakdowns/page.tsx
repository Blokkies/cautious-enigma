"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, Clock, Package } from "lucide-react";
import { toast } from "sonner";

interface BreakdownItem {
  id: number;
  clientName: string | null;
  quantity: number;
  poNumber: string | null;
  reason: string | null;
  approvalStatus: string;
  createdAt: string;
  teamName: string;
  itemCode: string | null;
  itemDescription: string | null;
}

export default function SupervisorBreakdownsPage() {
  const [allBreakdowns, setAllBreakdowns] = useState<BreakdownItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBreakdowns = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/breakdowns");
      if (res.ok) {
        const data = await res.json();
        setAllBreakdowns(data.breakdowns || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBreakdowns();
    const interval = setInterval(loadBreakdowns, 10000);
    return () => clearInterval(interval);
  }, [loadBreakdowns]);

  const handleAction = async (
    breakdownId: number,
    status: "approved" | "rejected"
  ) => {
    try {
      const res = await fetch("/api/supervisor/breakdowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdownId, status }),
      });
      if (res.ok) {
        toast.success(`Breakdown ${status}`);
        loadBreakdowns();
      }
    } catch {
      toast.error("Failed to update");
    }
  };

  const pending = allBreakdowns.filter(
    (b) => b.approvalStatus === "pending"
  );
  const resolved = allBreakdowns.filter(
    (b) => b.approvalStatus !== "pending"
  );

  const statusIcons = {
    pending: <Clock className="h-3 w-3" />,
    approved: <CheckCircle2 className="h-3 w-3" />,
    rejected: <XCircle className="h-3 w-3" />,
  };

  const statusStyles = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  const BreakdownCard = ({ b }: { b: BreakdownItem }) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-medium">
              {b.teamName}
            </Badge>
            {b.clientName && (
              <span className="font-semibold">{b.clientName}</span>
            )}
          </div>
          <Badge
            className={
              statusStyles[
                b.approvalStatus as keyof typeof statusStyles
              ] || ""
            }
          >
            {statusIcons[b.approvalStatus as keyof typeof statusIcons]}{" "}
            <span className="ml-1">{b.approvalStatus}</span>
          </Badge>
        </div>

        <div className="text-sm space-y-1 mb-2">
          <div>
            Qty: <span className="font-semibold">{b.quantity}</span>
          </div>
          {b.itemCode && (
            <div>
              Item: <span className="font-mono">{b.itemCode}</span>
              {b.itemDescription && (
                <span className="text-muted-foreground ml-1">
                  - {b.itemDescription}
                </span>
              )}
            </div>
          )}
          {b.poNumber && <div>PO: {b.poNumber}</div>}
          {b.reason && (
            <div className="text-muted-foreground">{b.reason}</div>
          )}
        </div>

        <div className="text-xs text-muted-foreground mb-2">
          {new Date(b.createdAt).toLocaleString()}
        </div>

        {b.approvalStatus === "pending" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleAction(b.id, "approved")}
              className="bg-green-600 hover:bg-green-700 gap-1"
            >
              <CheckCircle2 className="h-3 w-3" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAction(b.id, "rejected")}
              className="text-red-600 border-red-300 gap-1"
            >
              <XCircle className="h-3 w-3" />
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Breakdowns</h1>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolved.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="space-y-3 mt-3">
          {pending.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
              No pending breakdowns
            </div>
          ) : (
            pending.map((b) => <BreakdownCard key={b.id} b={b} />)
          )}
        </TabsContent>
        <TabsContent value="resolved" className="space-y-3 mt-3">
          {resolved.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No resolved breakdowns
            </div>
          ) : (
            resolved.map((b) => <BreakdownCard key={b.id} b={b} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
