"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, MessageSquare, Send, ChevronDown, ChevronRight } from "lucide-react";
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
  itemCode?: string;
  itemDescription?: string;
}

export default function QueriesPage() {
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newQuery, setNewQuery] = useState({
    queryType: "",
    message: "",
    itemId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const toggleCard = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    markNotificationSeen("queries");
  }, []);

  const loadQueries = useCallback(async () => {
    try {
      const res = await fetch("/api/team/queries");
      if (res.ok) {
        const data = await res.json();
        setQueries(data.queries || []);
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

  const handleSubmit = async () => {
    if (!newQuery.queryType || !newQuery.message.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/team/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newQuery),
      });
      if (res.ok) {
        toast.success("Query submitted");
        setShowNew(false);
        setNewQuery({ queryType: "", message: "", itemId: "" });
        loadQueries();
      } else {
        toast.error("Failed to submit query");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (queryId: number) => {
    if (!replyText.trim()) {
      toast.error("Please enter a message");
      return;
    }
    setSendingReply(true);
    try {
      const res = await fetch("/api/team/queries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, message: replyText }),
      });
      if (res.ok) {
        toast.success("Message sent");
        setReplyingTo(null);
        setReplyText("");
        loadQueries();
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

  const queryTypeLabels: Record<string, string> = {
    missing_item: "Missing Item",
    damaged: "Damaged Stock",
    wrong_location: "Wrong Location",
    quantity_question: "Quantity Question",
    other: "Other",
  };

  // Sort: open queries first, then resolved
  const sortedQueries = [...queries].sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return 0;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading queries...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Queries</h1>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              New Query
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Raise a Query</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Select
                  value={newQuery.queryType}
                  onValueChange={(v) =>
                    setNewQuery((p) => ({ ...p, queryType: v }))
                  }
                >
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Query type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(queryTypeLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Item code (optional)"
                value={newQuery.itemId}
                onChange={(e) =>
                  setNewQuery((p) => ({ ...p, itemId: e.target.value }))
                }
                className="h-12"
              />
              <Textarea
                placeholder="Describe the issue..."
                value={newQuery.message}
                onChange={(e) =>
                  setNewQuery((p) => ({ ...p, message: e.target.value }))
                }
                rows={4}
              />
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full h-12"
              >
                {submitting ? "Submitting..." : "Submit Query"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sortedQueries.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No queries yet</p>
          <p className="text-sm">Raise a query if you need help from a supervisor</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedQueries.map((q) => {
            const isCollapsed = collapsed.has(q.id);
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
              <button
                className={`w-full text-left px-3 py-2.5 border-b ${
                  q.status === "resolved"
                    ? "bg-green-50/50 border-green-100"
                    : "bg-amber-50/50 border-amber-100"
                }`}
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

              {!isCollapsed && (
              <CardContent className="p-3">

                {/* Chat thread */}
                {q.messages.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  {q.messages.map((m, i) => (
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

                {/* Reply input (only for open queries) */}
                {q.status === "open" && (
                  <>
                    {replyingTo === q.id ? (
                      <div className="space-y-2 mt-2">
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Type your message..."
                          rows={2}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleReply(q.id)}
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
                        className="mt-2 gap-1"
                        onClick={() => {
                          setReplyingTo(q.id);
                          setReplyText("");
                        }}
                      >
                        <Send className="h-3 w-3" />
                        Reply
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
              )}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
