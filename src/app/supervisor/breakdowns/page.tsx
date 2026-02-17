"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-context";
import { CheckCircle2, XCircle, Send, RotateCcw, Trash2, ChevronDown, ChevronRight, Users, Package } from "lucide-react";
import { toast } from "sonner";
import { markNotificationSeen } from "@/hooks/use-notifications";

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
  teamName: string;
  teamMembers: string | null;
  itemCode: string | null;
  itemDescription: string | null;
}

export default function SupervisorBreakdownsPage() {
  const { user } = useAuth();
  const isAuditor = user?.type === "auditor";
  const [allBreakdowns, setAllBreakdowns] = useState<BreakdownItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());

  useEffect(() => {
    markNotificationSeen("supervisorBreakdowns");
  }, []);

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

  const handleAction = async (breakdownId: number, status: "approved" | "rejected") => {
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

  const handleResetPending = async (breakdownId: number) => {
    try {
      const res = await fetch("/api/supervisor/breakdowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdownId, status: "pending" }),
      });
      if (res.ok) {
        toast.success("Reset to pending");
        loadBreakdowns();
      }
    } catch {
      toast.error("Failed to reset");
    }
  };

  const handleRespond = async (breakdownId: number) => {
    if (!responseText.trim()) {
      toast.error("Please enter a message");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/supervisor/breakdowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdownId, message: responseText }),
      });
      if (res.ok) {
        toast.success("Message sent");
        setRespondingTo(null);
        setResponseText("");
        loadBreakdowns();
      }
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (breakdownId: number) => {
    if (!confirm("Delete this breakdown? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/supervisor/breakdowns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakdownId }),
      });
      if (res.ok) {
        toast.success("Breakdown deleted");
        loadBreakdowns();
      }
    } catch {
      toast.error("Failed to delete");
    }
  };

  const toggleTeam = (teamName: string) => {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamName)) next.delete(teamName);
      else next.add(teamName);
      return next;
    });
  };

  const toggleCard = (id: number) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pending = allBreakdowns.filter((b) => b.approvalStatus === "pending");
  const approved = allBreakdowns.filter((b) => b.approvalStatus === "approved");
  const rejected = allBreakdowns.filter((b) => b.approvalStatus === "rejected");

  const groupByTeam = (list: BreakdownItem[]) => {
    const groups: Record<string, BreakdownItem[]> = {};
    for (const b of list) {
      if (!groups[b.teamName]) groups[b.teamName] = [];
      groups[b.teamName].push(b);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const getTeamMembers = (b: BreakdownItem) => {
    if (!b.teamMembers) return null;
    try { const arr = JSON.parse(b.teamMembers) as string[]; return arr.length > 0 ? arr.join(", ") : null; } catch { return null; }
  };

  const statusConfig = {
    pending: { label: "Pending", bg: "bg-amber-50/50 border-amber-100", border: "border-l-amber-500", badge: "bg-amber-100 text-amber-700" },
    approved: { label: "Approved", bg: "bg-green-50/50 border-green-100", border: "border-l-green-500", badge: "bg-green-100 text-green-700" },
    rejected: { label: "Rejected", bg: "bg-red-50/50 border-red-100", border: "border-l-red-500", badge: "bg-red-100 text-red-700" },
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  const renderBreakdownCard = (b: BreakdownItem) => {
    const cfg = statusConfig[b.approvalStatus as keyof typeof statusConfig] || statusConfig.pending;
    const isCollapsed = collapsedCards.has(b.id);

    return (
      <Card key={b.id} className={`overflow-hidden border-l-4 ${cfg.border}`}>
        {/* Heading — clickable to collapse */}
        <div className={`border-b ${cfg.bg}`}>
          <div className="flex items-start gap-2">
            <button
              className="flex-1 min-w-0 text-left px-4 py-2.5"
              onClick={() => toggleCard(b.id)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
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
                {isCollapsed && b.messages.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {b.messages.length} message{b.messages.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {!isCollapsed && b.itemDescription && (
                <p className="text-xs text-muted-foreground mt-1">{b.itemDescription}</p>
              )}
              <div className={`flex items-center gap-3 mt-1.5 text-sm ${isCollapsed ? "truncate" : ""}`}>
                <span>Client: <span className="font-semibold">{b.clientName || "—"}</span></span>
                <span>Qty: <span className="font-semibold">{b.quantity}</span></span>
              </div>
              {!isCollapsed && b.reason && (
                <p className="text-sm text-muted-foreground mt-1">{b.reason}</p>
              )}
              {!isCollapsed && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(b.createdAt).toLocaleString()}
                </p>
              )}
            </button>
            {!isAuditor && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 shrink-0 mt-2.5 mr-2"
                onClick={() => handleDelete(b.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {!isCollapsed && (
        <CardContent className="p-4">
          {/* Chat thread */}
          {b.messages.length > 0 && (
          <div className="space-y-2 mb-3">
            {b.messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.senderType === "supervisor" ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[85%]">
                  <span className={`text-[11px] font-medium text-muted-foreground ${m.senderType === "supervisor" ? "block text-right mr-1" : "ml-1"}`}>
                    {m.senderName}
                  </span>
                  <div className={`rounded-2xl px-3 py-2 text-sm ${
                    m.senderType === "supervisor"
                      ? "bg-blue-500 text-white rounded-tr-sm"
                      : "bg-gray-100 border border-gray-200 rounded-tl-sm"
                  }`}>
                    <p>{m.message}</p>
                  </div>
                  <span className={`text-[10px] text-muted-foreground ${m.senderType === "supervisor" ? "block text-right mr-1" : "ml-1"}`}>
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
          )}

          {/* Actions */}
          {!isAuditor && b.approvalStatus === "pending" && (
            <>
              {respondingTo === b.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Type a message..."
                    rows={2}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleRespond(b.id)}
                      disabled={submitting}
                      size="sm"
                      className="gap-1"
                    >
                      <Send className="h-3 w-3" />
                      {submitting ? "Sending..." : "Send"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRespondingTo(null);
                        setResponseText("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => {
                      setRespondingTo(b.id);
                      setResponseText("");
                    }}
                  >
                    <Send className="h-3 w-3" />
                    Message
                  </Button>
                </div>
              )}
            </>
          )}

          {!isAuditor && b.approvalStatus !== "pending" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => handleResetPending(b.id)}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset to Pending
              </Button>
              {respondingTo === b.id ? (
                <div className="flex-1 space-y-2">
                  <Textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Type a message..."
                    rows={2}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleRespond(b.id)}
                      disabled={submitting}
                      size="sm"
                      className="gap-1"
                    >
                      <Send className="h-3 w-3" />
                      {submitting ? "Sending..." : "Send"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRespondingTo(null);
                        setResponseText("");
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
                    setRespondingTo(b.id);
                    setResponseText("");
                  }}
                >
                  <Send className="h-3 w-3" />
                  Message
                </Button>
              )}
            </div>
          )}
        </CardContent>
        )}
      </Card>
    );
  };

  const renderTeamGroup = (teamName: string, teamBreakdowns: BreakdownItem[]) => {
    const isCollapsed = collapsedTeams.has(teamName);
    const members = getTeamMembers(teamBreakdowns[0]);

    return (
      <div key={teamName}>
        <button
          className="flex items-center gap-2 w-full text-left px-1 py-2 hover:bg-muted/50 rounded-lg transition-colors"
          onClick={() => toggleTeam(teamName)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="font-semibold text-sm">{teamName}</span>
            {members && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" />
                {members}
              </span>
            )}
          </div>
          <span className="text-[11px] font-medium text-muted-foreground shrink-0">
            {teamBreakdowns.length} breakdown{teamBreakdowns.length !== 1 ? "s" : ""}
          </span>
        </button>

        {!isCollapsed && (
          <div className="space-y-3 ml-6 mt-1 mb-4">
            {teamBreakdowns.map((b) => renderBreakdownCard(b))}
          </div>
        )}
      </div>
    );
  };

  const renderTabContent = (list: BreakdownItem[], emptyMsg: string) => {
    if (list.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          {emptyMsg}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {groupByTeam(list).map(([team, bs]) => renderTeamGroup(team, bs))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Breakdowns</h1>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({approved.length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected ({rejected.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-3">
          {renderTabContent(pending, "No pending breakdowns")}
        </TabsContent>
        <TabsContent value="approved" className="mt-3">
          {renderTabContent(approved, "No approved breakdowns")}
        </TabsContent>
        <TabsContent value="rejected" className="mt-3">
          {renderTabContent(rejected, "No rejected breakdowns")}
        </TabsContent>
      </Tabs>
    </div>
  );
}
