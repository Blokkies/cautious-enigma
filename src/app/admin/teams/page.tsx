"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
} from "@/components/ui/dialog";
import { Plus, Trash2, Users, Shield, Pencil, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface TeamInfo {
  id: number;
  name: string;
  member1: string | null;
  member2: string | null;
  assignedItems: number;
}

interface SupervisorInfo {
  id: number;
  name: string;
  role: string;
}

interface EventOption {
  id: number;
  name: string;
  status: string;
}

export default function TeamsPage() {
  const searchParams = useSearchParams();
  const urlEventId = searchParams.get("eventId");

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(urlEventId || "");
  const [teamsList, setTeamsList] = useState<TeamInfo[]>([]);
  const [supervisorsList, setSupervisorsList] = useState<SupervisorInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Team form
  const [teamForm, setTeamForm] = useState({
    name: "",
    member1: "",
    member2: "",
    pin: "",
  });

  // Supervisor form
  const [supForm, setSupForm] = useState({
    name: "",
    pin: "",
  });

  // Bulk create
  const [bulkCount, setBulkCount] = useState("13");
  const [bulkPrefix, setBulkPrefix] = useState("Team");
  const [bulkPin, setBulkPin] = useState("");

  // Edit team
  const [editTeam, setEditTeam] = useState<TeamInfo | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    member1: "",
    member2: "",
    pin: "",
  });

  const openEditDialog = (team: TeamInfo) => {
    setEditTeam(team);
    setEditForm({
      name: team.name,
      member1: team.member1 || "",
      member2: team.member2 || "",
      pin: "",
    });
  };

  const saveEditTeam = async () => {
    if (!editTeam) return;
    if (!editForm.name) {
      toast.error("Team name is required");
      return;
    }
    if (editForm.pin && editForm.pin.length < 4) {
      toast.error("PIN must be at least 4 digits");
      return;
    }
    try {
      const res = await fetch("/api/admin/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTeam.id,
          name: editForm.name,
          member1: editForm.member1,
          member2: editForm.member2,
          pin: editForm.pin || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Team updated");
        setEditTeam(null);
        loadTeams();
      } else {
        toast.error("Failed to update team");
      }
    } catch {
      toast.error("Failed to update team");
    }
  };

  const loadEvents = useCallback(async () => {
    const res = await fetch("/api/admin/events");
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events || []);
      if (!urlEventId) {
        const setupEvent = data.events?.find(
          (e: EventOption) => e.status === "setup" || e.status === "active"
        );
        if (setupEvent) setSelectedEventId(String(setupEvent.id));
      }
    }
    setLoading(false);
  }, [urlEventId]);

  const loadTeams = useCallback(async () => {
    if (!selectedEventId) return;
    const res = await fetch(`/api/admin/teams?eventId=${selectedEventId}`);
    if (res.ok) {
      const data = await res.json();
      setTeamsList(data.teams || []);
      setSupervisorsList(data.supervisors || []);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (selectedEventId) loadTeams();
  }, [selectedEventId, loadTeams]);

  const createTeam = async () => {
    if (!teamForm.name || !teamForm.pin) {
      toast.error("Team name and PIN are required");
      return;
    }
    if (teamForm.pin.length < 4) {
      toast.error("PIN must be at least 4 digits");
      return;
    }
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(selectedEventId),
          type: "team",
          ...teamForm,
        }),
      });
      if (res.ok) {
        toast.success("Team created");
        setTeamForm({ name: "", member1: "", member2: "", pin: "" });
        loadTeams();
      }
    } catch {
      toast.error("Failed to create team");
    }
  };

  const createSupervisor = async () => {
    if (!supForm.name || !supForm.pin) {
      toast.error("Name and PIN are required");
      return;
    }
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(selectedEventId),
          type: "supervisor",
          name: supForm.name,
          pin: supForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Supervisor created");
        setSupForm({ name: "", pin: "" });
        loadTeams();
      }
    } catch {
      toast.error("Failed to create supervisor");
    }
  };

  const bulkCreateTeams = async () => {
    const count = parseInt(bulkCount);
    if (isNaN(count) || count < 1 || count > 50) {
      toast.error("Enter a valid number (1-50)");
      return;
    }
    if (!bulkPin || bulkPin.length < 4) {
      toast.error("Enter a base PIN (at least 4 digits)");
      return;
    }

    let created = 0;
    for (let i = 1; i <= count; i++) {
      const pin = String(parseInt(bulkPin) + i - 1).padStart(4, "0");
      try {
        const res = await fetch("/api/admin/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: Number(selectedEventId),
            type: "team",
            name: `${bulkPrefix} ${i}`,
            pin,
          }),
        });
        if (res.ok) created++;
      } catch {
        // continue
      }
    }
    toast.success(`Created ${created} teams`);
    loadTeams();
  };

  const handleDelete = async (id: number, type: "team" | "supervisor") => {
    if (
      !confirm(
        `Delete this ${type}? ${type === "team" ? "All item assignments will be removed." : ""}`
      )
    )
      return;

    try {
      const res = await fetch("/api/admin/teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type }),
      });
      if (res.ok) {
        toast.success(`${type} deleted`);
        loadTeams();
      }
    } catch {
      toast.error("Delete failed");
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  const selectedEvent = events.find((e) => String(e.id) === selectedEventId);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/setup"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Events
        </Link>
        {selectedEvent && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{selectedEvent.name}</span>
          </>
        )}
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Teams</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams & Supervisors</h1>
        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select event..." />
          </SelectTrigger>
          <SelectContent>
            {events.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Teams List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Teams ({teamsList.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {teamsList.length > 0 ? (
            <div className="space-y-2 mb-4">
              {teamsList.map((team) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <div className="font-medium">{team.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {[team.member1, team.member2]
                        .filter(Boolean)
                        .join(", ") || "No members set"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      {team.assignedItems} items
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(team)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(team.id, "team")}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground mb-4">
              No teams yet. Create teams below.
            </p>
          )}

          <Separator className="my-4" />

          {/* Add Single Team */}
          <div className="space-y-3">
            <h3 className="font-medium">Add Team</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Team name"
                value={teamForm.name}
                onChange={(e) =>
                  setTeamForm((p) => ({ ...p, name: e.target.value }))
                }
              />
              <Input
                placeholder="4-digit PIN"
                type="password"
                maxLength={6}
                value={teamForm.pin}
                onChange={(e) =>
                  setTeamForm((p) => ({
                    ...p,
                    pin: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
              <Input
                placeholder="Member 1 name"
                value={teamForm.member1}
                onChange={(e) =>
                  setTeamForm((p) => ({ ...p, member1: e.target.value }))
                }
              />
              <Input
                placeholder="Member 2 name"
                value={teamForm.member2}
                onChange={(e) =>
                  setTeamForm((p) => ({ ...p, member2: e.target.value }))
                }
              />
            </div>
            <Button onClick={createTeam} className="gap-1">
              <Plus className="h-4 w-4" />
              Add Team
            </Button>
          </div>

          <Separator className="my-4" />

          {/* Bulk Create */}
          <div className="space-y-3">
            <h3 className="font-medium">Bulk Create Teams</h3>
            <div className="grid grid-cols-3 gap-3">
              <Input
                placeholder="Prefix (e.g. Team)"
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Count"
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
              />
              <Input
                placeholder="Base PIN (e.g. 1001)"
                value={bulkPin}
                onChange={(e) =>
                  setBulkPin(e.target.value.replace(/\D/g, ""))
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Creates teams with sequential PINs (e.g. Team 1=1001, Team
              2=1002, etc.)
            </p>
            <Button onClick={bulkCreateTeams} variant="outline" className="gap-1">
              <Plus className="h-4 w-4" />
              Bulk Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Edit Team Dialog */}
      <Dialog open={!!editTeam} onOpenChange={(open) => !open && setEditTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Team name"
              value={editForm.name}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, name: e.target.value }))
              }
            />
            <Input
              placeholder="Member 1 name"
              value={editForm.member1}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, member1: e.target.value }))
              }
            />
            <Input
              placeholder="Member 2 name"
              value={editForm.member2}
              onChange={(e) =>
                setEditForm((p) => ({ ...p, member2: e.target.value }))
              }
            />
            <Input
              placeholder="New PIN (leave empty to keep current)"
              type="password"
              maxLength={6}
              value={editForm.pin}
              onChange={(e) =>
                setEditForm((p) => ({
                  ...p,
                  pin: e.target.value.replace(/\D/g, ""),
                }))
              }
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditTeam(null)}>
                Cancel
              </Button>
              <Button onClick={saveEditTeam}>Save Changes</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Supervisors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Supervisors ({supervisorsList.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {supervisorsList.length > 0 && (
            <div className="space-y-2 mb-4">
              {supervisorsList.map((sup) => (
                <div
                  key={sup.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="font-medium">{sup.name}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(sup.id, "supervisor")}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-medium">Add Supervisor</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Supervisor name"
                value={supForm.name}
                onChange={(e) =>
                  setSupForm((p) => ({ ...p, name: e.target.value }))
                }
              />
              <Input
                placeholder="4-digit PIN"
                type="password"
                maxLength={6}
                value={supForm.pin}
                onChange={(e) =>
                  setSupForm((p) => ({
                    ...p,
                    pin: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </div>
            <Button onClick={createSupervisor} className="gap-1">
              <Plus className="h-4 w-4" />
              Add Supervisor
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
