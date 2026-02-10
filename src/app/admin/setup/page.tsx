"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface EventInfo {
  id: number;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  status: string;
  itemCount: number;
  teamCount: number;
  supervisorCount: number;
}

export default function AdminSetup() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "Rubicon Stocktake 2026",
    location: "Newton Park, Port Elizabeth",
    startDate: "",
    endDate: "",
  });

  const loadEvents = async () => {
    try {
      const res = await fetch("/api/admin/events");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch {
      toast.error("Failed to load events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Event name is required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success("Event created");
        loadEvents();
        setForm({
          name: "",
          location: "",
          startDate: "",
          endDate: "",
        });
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create event");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  };

  const statusColors: Record<string, string> = {
    setup: "bg-blue-100 text-blue-800",
    active: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    locked: "bg-red-100 text-red-800",
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Event Setup</h1>

      {/* Existing Events */}
      {events.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-lg">Existing Events</h2>
          {events.map((event) => (
            <Card key={event.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-lg">{event.name}</div>
                    {event.location && (
                      <div className="text-sm text-muted-foreground">
                        {event.location}
                      </div>
                    )}
                    <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                      <span>{event.itemCount} items</span>
                      <span>{event.teamCount} teams</span>
                      <span>{event.supervisorCount} supervisors</span>
                    </div>
                  </div>
                  <Badge className={statusColors[event.status] || ""}>
                    {event.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create New Event */}
      <Card>
        <CardHeader>
          <CardTitle>Create New Stocktake Event</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Event Name</Label>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((p) => ({ ...p, name: e.target.value }))
              }
              placeholder="e.g. Rubicon Stocktake 2026"
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input
              value={form.location}
              onChange={(e) =>
                setForm((p) => ({ ...p, location: e.target.value }))
              }
              placeholder="e.g. Newton Park Warehouse"
              className="h-12"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm((p) => ({ ...p, startDate: e.target.value }))
                }
                className="h-12"
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) =>
                  setForm((p) => ({ ...p, endDate: e.target.value }))
                }
                className="h-12"
              />
            </div>
          </div>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="w-full h-12"
          >
            {creating ? "Creating..." : "Create Event"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
