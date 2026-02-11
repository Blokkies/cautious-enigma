"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Clock, Send, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface QueryItem {
  id: number;
  queryType: string;
  message: string;
  response: string | null;
  status: string;
  createdAt: string;
  teamName: string;
  itemCode: string | null;
}

export default function SupervisorQueriesPage() {
  const [allQueries, setAllQueries] = useState<QueryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const queryTypeLabels: Record<string, string> = {
    missing_item: "Missing Item",
    damaged: "Damaged Stock",
    wrong_location: "Wrong Location",
    quantity_question: "Quantity Question",
    other: "Other",
  };

  const openQueries = allQueries.filter((q) => q.status === "open");
  const resolvedQueries = allQueries.filter((q) => q.status === "resolved");

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  const QueryCard = ({ q }: { q: QueryItem }) => (
    <Card key={q.id}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-medium">
              {q.teamName}
            </Badge>
            <Badge variant="secondary">
              {queryTypeLabels[q.queryType] || q.queryType}
            </Badge>
            {q.itemCode && (
              <span className="text-xs font-mono text-muted-foreground">
                {q.itemCode}
              </span>
            )}
          </div>
          <Badge
            className={
              q.status === "resolved"
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }
          >
            {q.status === "resolved" ? (
              <CheckCircle2 className="h-3 w-3 mr-1" />
            ) : (
              <Clock className="h-3 w-3 mr-1" />
            )}
            {q.status}
          </Badge>
        </div>

        <p className="text-sm mb-2">{q.message}</p>

        {q.response && (
          <div className="bg-blue-50 p-3 rounded text-sm text-blue-900 border border-blue-200 mb-2">
            <span className="font-semibold">Your response:</span> {q.response}
          </div>
        )}

        <div className="text-xs text-muted-foreground mb-2">
          {new Date(q.createdAt).toLocaleString()}
        </div>

        {q.status === "open" && (
          <>
            {respondingTo === q.id ? (
              <div className="space-y-2">
                <Textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Type your response..."
                  rows={3}
                  dir="ltr"
                  className="text-left"
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
                    {submitting ? "Sending..." : "Send Response"}
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
                  onClick={() => setRespondingTo(q.id)}
                >
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

        {q.status === "resolved" && (
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
    </Card>
  );

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
        <TabsContent value="open" className="space-y-3 mt-3">
          {openQueries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No open queries
            </div>
          ) : (
            openQueries.map((q) => <QueryCard key={q.id} q={q} />)
          )}
        </TabsContent>
        <TabsContent value="resolved" className="space-y-3 mt-3">
          {resolvedQueries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No resolved queries
            </div>
          ) : (
            resolvedQueries.map((q) => <QueryCard key={q.id} q={q} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
