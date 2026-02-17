"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-context";
import { CheckCircle2, Send, RotateCcw, Trash2, ChevronDown, ChevronRight, Users } from "lucide-react";
import { toast } from "sonner";
import { markNotificationSeen } from "@/hooks/use-notifications";

interface QueryMessage {
  senderType: "team" | "supervisor";
  senderName: string;
  message: string;
  createdAt: string;
}

interface QueryItem {
  id: number;
  queryType: string;
  message: string;
  messages: QueryMessage[];
  status: string;
  createdAt: string;
  teamName: string;
  teamMembers: string | null;
  itemCode: string | null;
  itemDescription: string | null;
}

export default function SupervisorQueriesPage() {
  const { user } = useAuth();
  const isAuditor = user?.type === "auditor";
  const [allQueries, setAllQueries] = useState<QueryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set());

  const toggleCard = (id: number) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    markNotificationSeen("supervisorQueries");
  }, []);

  const loadQueries = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/queries");
      if (res.ok) {
        const data = await res.json();
        setAllQueries(data.queries || []);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueries();
    const interval = setInterval(loadQueries, 10000);
    return () => clearInterval(interval);
  }, [loadQueries]);

  const handleRespond = async (queryId: number) => {
    if (!responseText.trim()) {
      toast.error("Please enter a response");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/supervisor/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, response: responseText, status: "open" }),
      });
      if (res.ok) {
        toast.success("Response sent");
        setRespondingTo(null);
        setResponseText("");
        loadQueries();
      }
    } catch {
      toast.error("Failed to send response");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (queryId: number) => {
    try {
      const res = await fetch("/api/supervisor/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, response: null, status: "resolved" }),
      });
      if (res.ok) {
        toast.success("Query resolved");
        loadQueries();
      }
    } catch {
      toast.error("Failed to resolve query");
    }
  };

  const handleReopen = async (queryId: number) => {
    try {
      const res = await fetch("/api/supervisor/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, status: "open" }),
      });
      if (res.ok) {
        toast.success("Query reopened");
        loadQueries();
      }
    } catch {
      toast.error("Failed to reopen query");
    }
  };

  const handleDelete = async (queryId: number) => {
    if (!confirm("Delete this query? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/supervisor/queries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId }),
      });
      if (res.ok) {
        toast.success("Query deleted");
        loadQueries();
      }
    } catch {
      toast.error("Failed to delete query");
    }
  };

  const toggleTeam = (teamName: string) => {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamName)) {
        next.delete(teamName);
      } else {
        next.add(teamName);
      }
      return next;
    });
  };

  const queryTypeLabels: Record<string, string> = {
    missing_item: "Missing Item",
    damaged: "Damaged Stock",
    wrong_location: "Wrong Location",
    quantity_question: "Quantity Question",
    other: "Other",
  };

  const openQueries = allQueries.filter((q) => q.status === "open");
  const resolvedQueries = allQueries.filter((q) => q.status === "resolved");

  // Group queries by team name
  const groupByTeam = (list: QueryItem[]) => {
    const groups: Record<string, QueryItem[]> = {};
    for (const q of list) {
      if (!groups[q.teamName]) groups[q.teamName] = [];
      groups[q.teamName].push(q);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const teamMembers = (q: QueryItem) => {
    if (!q.teamMembers) return null;
    try { const arr = JSON.parse(q.teamMembers) as string[]; return arr.length > 0 ? arr.join(", ") : null; } catch { return null; }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  const renderQueryCard = (q: QueryItem) => {
    const isCollapsed = collapsedCards.has(q.id);
    return (
    <Card
      key={q.id}
      className={`overflow-hidden border-l-4 ${
        q.status === "resolved"
          ? "border-l-green-500"
          : "border-l-amber-500"
      }`}
    >
      {/* Query heading — clickable to collapse */}
      <div className={`border-b ${
        q.status === "resolved"
          ? "bg-green-50/50 border-green-100"
          : "bg-amber-50/50 border-amber-100"
      }`}>
        <div className="flex items-start gap-2">
          <button
            className="flex-1 min-w-0 text-left px-4 py-2.5"
            onClick={() => toggleCard(q.id)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                q.status === "resolved"
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}>
                {q.status === "resolved" ? "Resolved" : "Open"}
              </span>
              <span className="text-xs font-medium bg-gray-100 border rounded px-1.5 py-0.5 text-gray-600">
                {queryTypeLabels[q.queryType] || q.queryType}
              </span>
              {q.itemCode && (
                <span className="text-xs bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 text-blue-700">
                  Part: <span className="font-mono font-semibold">{q.itemCode}</span>
                </span>
              )}
              {isCollapsed && q.messages.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {q.messages.length} message{q.messages.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {!isCollapsed && q.itemDescription && (
              <p className="text-xs text-muted-foreground mt-1">{q.itemDescription}</p>
            )}
            <p className={`text-sm mt-1.5 font-medium ${isCollapsed ? "truncate" : ""}`}>{q.message}</p>
            {!isCollapsed && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {new Date(q.createdAt).toLocaleString()}
              </p>
            )}
          </button>
          {!isAuditor && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 shrink-0 mt-2.5 mr-2"
              onClick={() => handleDelete(q.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {!isCollapsed && (
      <CardContent className="p-4">
        {/* Chat thread */}
        {q.messages.length > 0 && (
        <div className="space-y-2 mb-3">
          {q.messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.senderType === "supervisor" ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-[85%]">
                <span className={`text-[11px] font-medium text-muted-foreground ${m.senderType === "supervisor" ? "block text-right mr-1" : "ml-1"}`}>
                  {m.senderType === "supervisor" ? m.senderName : q.teamName}
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

        {!isAuditor && q.status === "open" && (
          <>
            {respondingTo === q.id ? (
              <div className="space-y-2">
                <Textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Type your response..."
                  rows={2}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleRespond(q.id)}
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    setRespondingTo(q.id);
                    setResponseText("");
                  }}
                >
                  <Send className="h-3 w-3" />
                  Respond
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => handleResolve(q.id)}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Resolve
                </Button>
              </div>
            )}
          </>
        )}

        {!isAuditor && q.status === "resolved" && (
          <Button
            variant="outline"
            size="sm"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => handleReopen(q.id)}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reopen
          </Button>
        )}
      </CardContent>
      )}
    </Card>
    );
  };

  const renderTeamGroup = (teamName: string, teamQueries: QueryItem[]) => {
    const isCollapsed = collapsedTeams.has(teamName);
    const members = teamMembers(teamQueries[0]);
    const openCount = teamQueries.filter((q) => q.status === "open").length;
    const resolvedCount = teamQueries.filter((q) => q.status === "resolved").length;

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
          <div className="flex items-center gap-1.5 shrink-0">
            {openCount > 0 && (
              <span className="text-[11px] font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                {openCount} open
              </span>
            )}
            {resolvedCount > 0 && (
              <span className="text-[11px] font-medium bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                {resolvedCount} resolved
              </span>
            )}
          </div>
        </button>

        {!isCollapsed && (
          <div className="space-y-3 ml-6 mt-1 mb-4">
            {teamQueries.map((q) => renderQueryCard(q))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Queries</h1>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">
            Open ({openQueries.length})
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved ({resolvedQueries.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="mt-3">
          {openQueries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No open queries
            </div>
          ) : (
            <div className="space-y-1">
              {groupByTeam(openQueries).map(([team, qs]) => renderTeamGroup(team, qs))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="resolved" className="mt-3">
          {resolvedQueries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No resolved queries
            </div>
          ) : (
            <div className="space-y-1">
              {groupByTeam(resolvedQueries).map(([team, qs]) => renderTeamGroup(team, qs))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
