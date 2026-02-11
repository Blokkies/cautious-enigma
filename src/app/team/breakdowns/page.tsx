"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Package, CheckCircle2, Clock, XCircle, Send } from "lucide-react";
import { toast } from "sonner";

interface BreakdownMessage {
  senderType: "team" | "supervisor";
  senderName: string;
  message: string;
  createdAt: string;
}

interface BreakdownItem {
  id: number;
  clientName: string | null;
  quantity: number;
  poNumber: string | null;
  reason: string | null;
  approvalStatus: string;
  messages: BreakdownMessage[];
  createdAt: string;
  itemCode?: string;
  itemDescription?: string;
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
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

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
    const interval = setInterval(loadBreakdowns, 10000);
    return () => clearInterval(interval);
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

  const handleReply = async (breakdownId: number) => {
    if (!replyText.trim()) {
      toast.error("Please enter a message");
      return;
    }
    setSendingReply(true);
    try {
      const res = await fetch("/api/team/breakdowns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdownId, message: replyText }),
      });
      if (res.ok) {
        toast.success("Message sent");
        setReplyingTo(null);
        setReplyText("");
        loadBreakdowns();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to send message");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSendingReply(false);
    }
  };

  const statusConfig = {
    pending: { label: "Pending", bg: "bg-amber-50/50 border-amber-100", border: "border-l-amber-500", badge: "bg-amber-100 text-amber-700" },
    approved: { label: "Approved", bg: "bg-green-50/50 border-green-100", border: "border-l-green-500", badge: "bg-green-100 text-green-700" },
    rejected: { label: "Rejected", bg: "bg-red-50/50 border-red-100", border: "border-l-red-500", badge: "bg-red-100 text-red-700" },
  };

  // Sort: pending first
  const sortedBreakdowns = [...breakdowns].sort((a, b) => {
    if (a.approvalStatus === "pending" && b.approvalStatus !== "pending") return -1;
    if (a.approvalStatus !== "pending" && b.approvalStatus === "pending") return 1;
    return 0;
  });

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

      {sortedBreakdowns.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No breakdowns</p>
          <p className="text-sm">Report stock that needs to move during the count</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedBreakdowns.map((b) => {
            const cfg = statusConfig[b.approvalStatus as keyof typeof statusConfig] || statusConfig.pending;

            return (
              <Card key={b.id} className={`overflow-hidden border-l-4 ${cfg.border}`}>
                {/* Heading */}
                <div className={`px-3 py-2.5 border-b ${cfg.bg}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    {b.itemCode && (
                      <span className="text-xs bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-blue-700">
                        Part: <span className="font-mono font-semibold">{b.itemCode}</span>
                      </span>
                    )}
                    {b.poNumber && (
                      <span className="text-xs bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 text-purple-700">
                        PO: <span className="font-semibold">{b.poNumber}</span>
                      </span>
                    )}
                  </div>
                  {b.itemDescription && (
                    <p className="text-xs text-muted-foreground mt-1">{b.itemDescription}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-sm">
                    <span>Client: <span className="font-semibold">{b.clientName || "—"}</span></span>
                    <span>Qty: <span className="font-semibold">{b.quantity}</span></span>
                  </div>
                  {b.reason && (
                    <p className="text-sm text-muted-foreground mt-1">{b.reason}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(b.createdAt).toLocaleString()}
                  </p>
                </div>

                <CardContent className="p-3">
                  {/* Chat thread */}
                  {b.messages.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {b.messages.map((m, i) => (
                      <div
                        key={i}
                        className={`flex ${m.senderType === "team" ? "justify-end" : "justify-start"}`}
                      >
                        <div className="max-w-[85%]">
                          <span className={`text-[11px] font-medium text-muted-foreground ${m.senderType === "team" ? "block text-right mr-1" : "ml-1"}`}>
                            {m.senderName}
                          </span>
                          <div className={`rounded-2xl px-3 py-2 text-sm ${
                            m.senderType === "team"
                              ? "bg-blue-500 text-white rounded-tr-sm"
                              : "bg-gray-100 border border-gray-200 rounded-tl-sm"
                          }`}>
                            <p>{m.message}</p>
                          </div>
                          <span className={`text-[10px] text-muted-foreground ${m.senderType === "team" ? "block text-right mr-1" : "ml-1"}`}>
                            {new Date(m.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Reply */}
                  {replyingTo === b.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Type your message..."
                        rows={2}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleReply(b.id)}
                          disabled={sendingReply}
                          size="sm"
                          className="gap-1"
                        >
                          <Send className="h-3 w-3" />
                          {sendingReply ? "Sending..." : "Send"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplyingTo(null);
                            setReplyText("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        setReplyingTo(b.id);
                        setReplyText("");
                      }}
                    >
                      <Send className="h-3 w-3" />
                      Message
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
