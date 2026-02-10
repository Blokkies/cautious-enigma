"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Package, CheckCircle2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";

interface BreakdownItem {
  id: number;
  clientName: string | null;
  quantity: number;
  poNumber: string | null;
  reason: string | null;
  approvalStatus: string;
  createdAt: string;
  itemCode?: string;
}

export default function BreakdownsPage() {
  const [breakdowns, setBreakdowns] = useState<BreakdownItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newBreakdown, setNewBreakdown] = useState({
    clientName: "",
    itemCode: "",
    quantity: "",
    poNumber: "",
    reason: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const loadBreakdowns = useCallback(async () => {
    try {
      const res = await fetch("/api/team/breakdowns");
      if (res.ok) {
        const data = await res.json();
        setBreakdowns(data.breakdowns || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBreakdowns();
  }, [loadBreakdowns]);

  const handleSubmit = async () => {
    if (
      !newBreakdown.clientName.trim() ||
      !newBreakdown.itemCode.trim() ||
      !newBreakdown.quantity ||
      !newBreakdown.poNumber.trim() ||
      !newBreakdown.reason.trim()
    ) {
      toast.error("All fields are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/team/breakdowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newBreakdown,
          quantity: parseFloat(newBreakdown.quantity),
        }),
      });
      if (res.ok) {
        toast.success("Breakdown submitted");
        setShowNew(false);
        setNewBreakdown({
          clientName: "",
          itemCode: "",
          quantity: "",
          poNumber: "",
          reason: "",
        });
        loadBreakdowns();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon = {
    pending: <Clock className="h-3 w-3" />,
    approved: <CheckCircle2 className="h-3 w-3" />,
    rejected: <XCircle className="h-3 w-3" />,
  };

  const statusStyle = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading breakdowns...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Breakdowns</h1>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              New Breakdown
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Report Stock Breakdown</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <Input
                placeholder="Client name"
                value={newBreakdown.clientName}
                onChange={(e) =>
                  setNewBreakdown((p) => ({ ...p, clientName: e.target.value }))
                }
                className="h-12"
              />
              <Input
                placeholder="Item code *"
                value={newBreakdown.itemCode}
                onChange={(e) =>
                  setNewBreakdown((p) => ({ ...p, itemCode: e.target.value }))
                }
                className="h-12"
              />
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Quantity"
                value={newBreakdown.quantity}
                onChange={(e) =>
                  setNewBreakdown((p) => ({ ...p, quantity: e.target.value }))
                }
                className="h-12"
              />
              <Input
                placeholder="PO Number *"
                value={newBreakdown.poNumber}
                onChange={(e) =>
                  setNewBreakdown((p) => ({ ...p, poNumber: e.target.value }))
                }
                className="h-12"
              />
              <Textarea
                placeholder="Reason / notes *"
                value={newBreakdown.reason}
                onChange={(e) =>
                  setNewBreakdown((p) => ({ ...p, reason: e.target.value }))
                }
                rows={3}
              />
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full h-12"
              >
                {submitting ? "Submitting..." : "Submit Breakdown"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {breakdowns.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No breakdowns</p>
          <p className="text-sm">Report stock that needs to move during the count</p>
        </div>
      ) : (
        <div className="space-y-3">
          {breakdowns.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-semibold">{b.clientName}</div>
                  <Badge
                    className={
                      statusStyle[
                        b.approvalStatus as keyof typeof statusStyle
                      ] || ""
                    }
                  >
                    {statusIcon[
                      b.approvalStatus as keyof typeof statusIcon
                    ]}{" "}
                    <span className="ml-1">{b.approvalStatus}</span>
                  </Badge>
                </div>
                <div className="text-sm space-y-1">
                  <div>Qty: <span className="font-semibold">{b.quantity}</span></div>
                  {b.itemCode && <div>Item: {b.itemCode}</div>}
                  {b.poNumber && <div>PO: {b.poNumber}</div>}
                  {b.reason && (
                    <div className="text-muted-foreground">{b.reason}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {new Date(b.createdAt).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
