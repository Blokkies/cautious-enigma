"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Users, Shield, Pencil, Upload, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { generateTeamTemplate } from "@/lib/team-excel";
import { parseMembers, type SupervisorInfo, type TeamInfo } from "./types";
import {
  AddPersonDialog,
  AddTeamDialog,
  BulkCreateDialog,
  EditTeamDialog,
  ImportTeamsDialog,
  type BulkProgress,
  type ImportResult,
} from "./team-dialogs";

interface TeamsManagerProps {
  /**
   * admin: supervisors list shows every supervisor (incl. auditors) with a delete button.
   * supervisor: auditors are split into their own section; supervisors cannot be deleted.
   */
  variant: "admin" | "supervisor";
  /** Event id as sent to the API (admin: selected event, supervisor: String(token eventId)). */
  eventId: string;
  /** Auditors get a read-only view (no PIN reveal, no create/edit/delete). */
  readOnly?: boolean;
  teamsList: TeamInfo[];
  supervisorsList: SupervisorInfo[];
  reloadTeams: () => void;
}

/**
 * Teams + supervisors management shared by /admin/teams and /supervisor/teams.
 * Renders the cards and dialogs below the page header.
 */
export function TeamsManager({
  variant,
  eventId,
  readOnly = false,
  teamsList,
  supervisorsList,
  reloadTeams: loadTeams,
}: TeamsManagerProps) {
  const isSupervisorView = variant === "supervisor";
  const [showPins, setShowPins] = useState(false);

  // Team form
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", pin: "" });
  const [teamMembers, setTeamMembers] = useState<string[]>([""]);

  // Supervisor form
  const [addSupOpen, setAddSupOpen] = useState(false);
  const [supForm, setSupForm] = useState({
    name: "",
    pin: "",
  });

  // Bulk create
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState("13");
  const [bulkPrefix, setBulkPrefix] = useState("Team");
  const [bulkPin, setBulkPin] = useState("");
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);

  // Edit team
  const [editTeam, setEditTeam] = useState<TeamInfo | null>(null);
  const [editForm, setEditForm] = useState({ name: "", pin: "" });
  const [editMembers, setEditMembers] = useState<string[]>([""]);

  // Import from Excel
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const openEditDialog = (team: TeamInfo) => {
    setEditTeam(team);
    const members = parseMembers(team.members);
    setEditForm({ name: team.name, pin: "" });
    setEditMembers(members.length > 0 ? members : [""]);
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
          members: editMembers.filter(m => m.trim()),
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
          eventId: Number(eventId),
          type: "team",
          name: teamForm.name,
          members: teamMembers.filter(m => m.trim()),
          pin: teamForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Team created");
        setTeamForm({ name: "", pin: "" });
        setTeamMembers([""]);
        setAddTeamOpen(false);
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
          eventId: Number(eventId),
          type: "supervisor",
          name: supForm.name,
          pin: supForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Supervisor created");
        setSupForm({ name: "", pin: "" });
        setAddSupOpen(false);
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
    setBulkProgress({ current: 0, total: count, created: 0 });
    for (let i = 1; i <= count; i++) {
      const pin = String(parseInt(bulkPin) + i - 1).padStart(4, "0");
      try {
        const res = await fetch("/api/admin/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: Number(eventId),
            type: "team",
            name: `${bulkPrefix} ${i}`,
            pin,
          }),
        });
        if (res.ok) created++;
      } catch {
        // continue
      }
      setBulkProgress({ current: i, total: count, created });
    }
    toast.success(`Created ${created} of ${count} teams`);
    setBulkProgress(null);
    setBulkOpen(false);
    setBulkPin("");
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
        // Supervisor view only deletes teams and capitalises the toast.
        toast.success(isSupervisorView ? "Team deleted" : `${type} deleted`);
        loadTeams();
      }
    } catch {
      toast.error("Delete failed");
    }
  };

  const downloadTemplate = () => {
    const data = generateTeamTemplate();
    const blob = new Blob([data as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team-import-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTeams = async () => {
    if (!importFile) {
      toast.error("Please select a file");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("eventId", eventId);
      const res = await fetch("/api/admin/teams/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }
      setImportResult(data.summary);
      if (data.success) {
        toast.success(`${data.summary.teamsCreated} team(s) imported`);
        loadTeams();
      }
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  // Supervisor view lists auditors separately (see AuditorSection).
  const visibleSupervisors = isSupervisorView
    ? supervisorsList.filter(s => s.role !== "auditor")
    : supervisorsList;

  return (
    <>
      {/* Teams List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Teams ({teamsList.length})
            </CardTitle>
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPins((v) => !v)}
                className="gap-1.5 text-muted-foreground"
              >
                {showPins ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showPins ? "Hide PINs" : "Show PINs"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {teamsList.length > 0 ? (
            <div className="space-y-2 mb-4">
              {teamsList.map((team) => {
                const memberList = parseMembers(team.members);
                return (
                  <div
                    key={team.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <div className="font-medium">{team.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {memberList.length > 0 ? memberList.join(", ") : "No members set"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {showPins && team.pinPlain && (
                        <Badge variant="outline" className="font-mono text-xs">
                          PIN: {team.pinPlain}
                        </Badge>
                      )}
                      <Badge variant="secondary">
                        {team.assignedItems} items
                      </Badge>
                      {!readOnly && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground mb-4">
              No teams yet. Create teams below.
            </p>
          )}

          {!readOnly && (
            <>
              <Separator className="my-4" />

              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => { setAddTeamOpen(true); setTeamForm({ name: "", pin: "" }); setTeamMembers([""]); }} className="gap-1">
                  <Plus className="h-4 w-4" />
                  Add Team
                </Button>
                <Button onClick={() => setBulkOpen(true)} variant="outline" className="gap-1">
                  <Plus className="h-4 w-4" />
                  Bulk Create
                </Button>
                <Button onClick={() => { setImportOpen(true); setImportFile(null); setImportResult(null); }} variant="outline" className="gap-1">
                  <Upload className="h-4 w-4" />
                  Import from Excel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AddTeamDialog
        open={addTeamOpen}
        onClose={() => setAddTeamOpen(false)}
        form={teamForm}
        setForm={setTeamForm}
        members={teamMembers}
        setMembers={setTeamMembers}
        onCreate={createTeam}
      />

      <EditTeamDialog
        open={!!editTeam}
        onClose={() => setEditTeam(null)}
        form={editForm}
        setForm={setEditForm}
        members={editMembers}
        setMembers={setEditMembers}
        onSave={saveEditTeam}
      />

      <BulkCreateDialog
        open={bulkOpen}
        setOpen={setBulkOpen}
        prefix={bulkPrefix}
        setPrefix={setBulkPrefix}
        count={bulkCount}
        setCount={setBulkCount}
        pin={bulkPin}
        setPin={setBulkPin}
        progress={bulkProgress}
        onCreate={bulkCreateTeams}
      />

      <ImportTeamsDialog
        open={importOpen}
        setOpen={setImportOpen}
        importFile={importFile}
        onFileChange={(file) => {
          setImportFile(file);
          setImportResult(null);
        }}
        importing={importing}
        importResult={importResult}
        onDownloadTemplate={downloadTemplate}
        onImport={importTeams}
      />

      {/* Supervisors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Supervisors ({visibleSupervisors.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleSupervisors.length > 0 && (
            <div className="space-y-2 mb-4">
              {visibleSupervisors.map((sup) => (
                <div
                  key={sup.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="font-medium">{sup.name}</div>
                  {isSupervisorView ? (
                    showPins && sup.pinPlain && (
                      <Badge variant="outline" className="font-mono text-xs">
                        PIN: {sup.pinPlain}
                      </Badge>
                    )
                  ) : (
                    <div className="flex items-center gap-3">
                      {showPins && sup.pinPlain && (
                        <Badge variant="outline" className="font-mono text-xs">
                          PIN: {sup.pinPlain}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(sup.id, "supervisor")}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!readOnly && (
            <Button onClick={() => { setAddSupOpen(true); setSupForm({ name: "", pin: "" }); }} className="gap-1">
              <Plus className="h-4 w-4" />
              Add Supervisor
            </Button>
          )}
        </CardContent>
      </Card>

      <AddPersonDialog
        open={addSupOpen}
        onClose={() => setAddSupOpen(false)}
        title="Add Supervisor"
        namePlaceholder="Supervisor name"
        submitLabel="Create Supervisor"
        form={supForm}
        setForm={setSupForm}
        onCreate={createSupervisor}
      />

      {/* Auditors */}
      {isSupervisorView && (
        <AuditorSection eventId={eventId} isAuditor={readOnly} supervisorsList={supervisorsList} onCreated={loadTeams} showPins={showPins} />
      )}
    </>
  );
}

function AuditorSection({ eventId, isAuditor, supervisorsList, onCreated, showPins }: { eventId: string; isAuditor: boolean; supervisorsList: SupervisorInfo[]; onCreated: () => void; showPins: boolean }) {
  const [addAuditorOpen, setAddAuditorOpen] = useState(false);
  const [auditorForm, setAuditorForm] = useState({ name: "", pin: "" });
  const auditors = supervisorsList.filter(s => s.role === "auditor");

  const createAuditor = async () => {
    if (!auditorForm.name || !auditorForm.pin) {
      toast.error("Name and PIN are required");
      return;
    }
    if (auditorForm.pin.length < 4) {
      toast.error("PIN must be at least 4 digits");
      return;
    }
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eventId),
          type: "auditor",
          name: auditorForm.name,
          pin: auditorForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Auditor created");
        setAuditorForm({ name: "", pin: "" });
        setAddAuditorOpen(false);
        onCreated();
      } else {
        toast.error("Failed to create auditor");
      }
    } catch {
      toast.error("Failed to create auditor");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Auditors ({auditors.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditors.length > 0 && (
            <div className="space-y-2 mb-4">
              {auditors.map((aud) => (
                <div
                  key={aud.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="font-medium">{aud.name}</div>
                  {showPins && aud.pinPlain && (
                    <Badge variant="outline" className="font-mono text-xs">
                      PIN: {aud.pinPlain}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}

          {!isAuditor && (
            <Button onClick={() => { setAddAuditorOpen(true); setAuditorForm({ name: "", pin: "" }); }} className="gap-1">
              <Plus className="h-4 w-4" />
              Add Auditor
            </Button>
          )}
        </CardContent>
      </Card>

      <AddPersonDialog
        open={addAuditorOpen}
        onClose={() => setAddAuditorOpen(false)}
        title="Add Auditor"
        namePlaceholder="Auditor name"
        submitLabel="Create Auditor"
        form={auditorForm}
        setForm={setAuditorForm}
        onCreate={createAuditor}
      />
    </>
  );
}
