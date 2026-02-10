"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, CheckCircle2, AlertTriangle, Lock, XCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface EventInfo {
  id: number;
  name: string;
  status: string;
  itemCount: number;
  teamCount: number;
  supervisorCount: number;
}

interface ReadinessCheck {
  hasItems: boolean;
  hasTeams: boolean;
  hasSupervisors: boolean;
  allItemsAssigned: boolean;
  unassignedCount: number;
}

export default function ActivatePage() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [readiness, setReadiness] = useState<ReadinessCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events || []);
      const setupEvent = data.events?.find(
        (e: EventInfo) => e.status === "setup"
      );
      if (setupEvent) setSelectedEventId(String(setupEvent.id));
    }
    setLoading(false);
  }, []);

  const checkReadiness = useCallback(async () => {
    if (!selectedEventId) return;
    try {
      const res = await fetch(
        `/api/admin/activate?eventId=${selectedEventId}`
      );
      if (res.ok) {
        const data = await res.json();
        setReadiness(data);
      }
    } catch {
      // error
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    checkReadiness();
  }, [checkReadiness]);

  const handleActivate = async () => {
    if (!selectedEventId) return;

    if (readiness && !readiness.allItemsAssigned) {
      if (
        !confirm(
          `${readiness.unassignedCount} items are unassigned. Activate anyway?`
        )
      )
        return;
    }

    setActivating(true);
    try {
      const res = await fetch("/api/admin/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(selectedEventId) }),
      });
      if (res.ok) {
        toast.success("Stocktake activated! Teams can now log in.");
        loadEvents();
        checkReadiness();
      } else {
        const data = await res.json();
        toast.error(data.error || "Activation failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setActivating(false);
    }
  };

  const handleComplete = async () => {
    if (!confirm("Mark this stocktake as completed? Teams will no longer be able to submit counts.")) return;
    try {
      const res = await fetch("/api/admin/activate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(selectedEventId),
          status: "completed",
        }),
      });
      if (res.ok) {
        toast.success("Stocktake marked as completed");
        loadEvents();
      }
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel this active stocktake and reset it to setup? All count data will be preserved but teams will be logged out.")) return;
    try {
      const res = await fetch("/api/admin/activate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(selectedEventId),
          status: "setup",
        }),
      });
      if (res.ok) {
        toast.success("Stocktake reset to setup");
        loadEvents();
        checkReadiness();
      }
    } catch {
      toast.error("Failed to cancel stocktake");
    }
  };

  const handleDelete = async () => {
    const eventName = selectedEvent?.name || "this event";
    if (!confirm(`PERMANENTLY DELETE "${eventName}" and ALL its data (items, counts, teams, queries, breakdowns)? This cannot be undone!`)) return;
    if (!confirm(`Are you absolutely sure? Type confirms deletion of all data for "${eventName}".`)) return;
    try {
      const res = await fetch("/api/admin/activate", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: Number(selectedEventId) }),
      });
      if (res.ok) {
        toast.success("Event deleted successfully");
        setSelectedEventId("");
        setReadiness(null);
        loadEvents();
      } else {
        const data = await res.json();
        toast.error(data.error || "Delete failed");
      }
    } catch {
      toast.error("Failed to delete event");
    }
  };

  const selectedEvent = events.find(
    (e) => String(e.id) === selectedEventId
  );

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Activate Stocktake</h1>

      <Select value={selectedEventId} onValueChange={setSelectedEventId}>
        <SelectTrigger className="h-12">
          <SelectValue placeholder="Select event..." />
        </SelectTrigger>
        <SelectContent>
          {events.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.name} ({e.status})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedEvent && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{selectedEvent.name}</CardTitle>
              <Badge
                className={
                  selectedEvent.status === "active"
                    ? "bg-green-100 text-green-800"
                    : selectedEvent.status === "completed"
                    ? "bg-gray-100 text-gray-800"
                    : "bg-blue-100 text-blue-800"
                }
              >
                {selectedEvent.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">
                  {selectedEvent.itemCount.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Items</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {selectedEvent.teamCount}
                </div>
                <div className="text-sm text-muted-foreground">Teams</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {selectedEvent.supervisorCount}
                </div>
                <div className="text-sm text-muted-foreground">Supervisors</div>
              </div>
            </div>

            {/* Readiness Checks */}
            {readiness && selectedEvent.status === "setup" && (
              <div className="space-y-2">
                <h3 className="font-medium">Readiness Checks</h3>
                {[
                  { label: "Items imported", ok: readiness.hasItems },
                  { label: "Teams created", ok: readiness.hasTeams },
                  { label: "Supervisors created", ok: readiness.hasSupervisors },
                  {
                    label: `All items assigned${readiness.unassignedCount > 0 ? ` (${readiness.unassignedCount} unassigned)` : ""}`,
                    ok: readiness.allItemsAssigned,
                  },
                ].map((check) => (
                  <div
                    key={check.label}
                    className="flex items-center gap-2 text-sm"
                  >
                    {check.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            {selectedEvent.status === "setup" && (
              <Button
                onClick={handleActivate}
                disabled={activating}
                className="w-full h-14 text-lg gap-2"
                size="lg"
              >
                <Play className="h-5 w-5" />
                {activating ? "Activating..." : "Activate Stocktake"}
              </Button>
            )}

            {selectedEvent.status === "active" && (
              <div className="space-y-3">
                <Button
                  onClick={handleComplete}
                  variant="outline"
                  className="w-full h-12 gap-2"
                >
                  <Lock className="h-4 w-4" />
                  Mark as Completed
                </Button>
                <Button
                  onClick={handleCancel}
                  variant="outline"
                  className="w-full h-12 gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel Stocktake (Reset to Setup)
                </Button>
              </div>
            )}

            {/* Delete button - available for any status */}
            <div className="pt-4 border-t">
              <Button
                onClick={handleDelete}
                variant="outline"
                className="w-full h-12 gap-2 border-red-300 text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete Event Permanently
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
