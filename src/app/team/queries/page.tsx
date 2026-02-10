"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Plus, MessageSquare, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

interface QueryItem {
  id: number;
  queryType: string;
  message: string;
  response: string | null;
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

  const queryTypeLabels: Record<string, string> = {
    missing_item: "Missing Item",
    damaged: "Damaged Stock",
    wrong_location: "Wrong Location",
    quantity_question: "Quantity Question",
    other: "Other",
  };

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

      {queries.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No queries yet</p>
          <p className="text-sm">Raise a query if you need help from a supervisor</p>
        </div>
      ) : (
        <div className="space-y-3">
          {queries.map((q) => (
            <Card key={q.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <Badge variant="outline">
                    {queryTypeLabels[q.queryType] || q.queryType}
                  </Badge>
                  <Badge
                    variant={q.status === "resolved" ? "default" : "secondary"}
                    className={
                      q.status === "open" ? "bg-amber-100 text-amber-800" : ""
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
                  <div className="bg-blue-50 p-2 rounded text-sm text-blue-900 border border-blue-200">
                    <span className="font-semibold">Response:</span>{" "}
                    {q.response}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  {new Date(q.createdAt).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
