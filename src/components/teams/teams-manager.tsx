"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Eye, EyeOff, Layers, Pencil, Plus, Shield, Trash2, Upload, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { generateTeamTemplate } from "@/lib/team-excel";
import { plural } from "@/lib/format";
import { useConfirm } from "@/components/admin/confirm-dialog";
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
import { pinError } from "./pin";

interface TeamsManagerProps {
  /**
   * admin: can also add and delete supervisors and auditors.
   * supervisor: manages teams only; supervisors and auditors are listed read-only
   * (the API refuses supervisor/auditor changes from a supervisor).
   */
  variant: "admin" | "supervisor";
  /** Event id as sent to the API (admin: the workspace event, supervisor: String(token eventId)). */
  eventId: string;
  /** Auditors get a read-only view (no PIN reveal, no create/edit/delete). */
  readOnly?: boolean;
  teamsList: TeamInfo[];
  supervisorsList: SupervisorInfo[];
  /** Called after every change. */
  reloadTeams: () => void;
}

type PersonType = "supervisor" | "auditor";

/**
 * Teams, supervisors and auditors, shared by the admin People panel and /supervisor/teams.
 * Renders three sections plus their dialogs.
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
  // Only admins create/delete supervisors and auditors.
  const canManagePeople = !readOnly && !isSupervisorView;
  const [showPins, setShowPins] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // Team form
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", pin: "" });
  const [teamMembers, setTeamMembers] = useState<string[]>([""]);

  // Supervisor / auditor form (one dialog, `personType` picks the role)
  const [personType, setPersonType] = useState<PersonType | null>(null);
  const [personForm, setPersonForm] = useState({ name: "", pin: "" });

  // Bulk create
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState("");
  const [bulkPrefix, setBulkPrefix] = useState("Team");
  const [bulkPin, setBulkPin] = useState("");
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);

  // Edit team
  const [editTeam, setEditTeam] = useState<TeamInfo | null>(null);
  const [editForm, setEditForm] = useState({ name: "", pin: "" });
  const [editMembers, setEditMembers] = useState<string[]>([""]);

  // In-flight flags so a double click can't create/save twice
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [creatingPerson, setCreatingPerson] = useState(false);

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
    if (!editTeam || savingTeam) return;
    if (!editForm.name.trim()) {
      toast.error("Team name is required");
      return;
    }
    const editPinError = editForm.pin ? pinError(editForm.pin) : null;
    if (editPinError) {
      toast.error(editPinError);
      return;
    }
    setSavingTeam(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editTeam.id,
          name: editForm.name,
          members: editMembers.filter((m) => m.trim()),
          pin: editForm.pin || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Team updated");
        setEditTeam(null);
        loadTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to update team");
      }
    } catch {
      toast.error("Failed to update team");
    } finally {
      setSavingTeam(false);
    }
  };

  const createTeam = async () => {
    if (creatingTeam) return;
    if (!teamForm.name.trim() || !teamForm.pin) {
      toast.error("Team name and PIN are required");
      return;
    }
    const teamPinError = pinError(teamForm.pin);
    if (teamPinError) {
      toast.error(teamPinError);
      return;
    }
    setCreatingTeam(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eventId),
          type: "team",
          name: teamForm.name,
          members: teamMembers.filter((m) => m.trim()),
          pin: teamForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Team created");
        setTeamForm({ name: "", pin: "" });
        setTeamMembers([""]);
        setAddTeamOpen(false);
        loadTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to create team");
      }
    } catch {
      toast.error("Failed to create team");
    } finally {
      setCreatingTeam(false);
    }
  };

  /** Create a supervisor or auditor (admin only). */
  const createPerson = async () => {
    if (creatingPerson || !personType) return;
    if (!personForm.name.trim() || !personForm.pin) {
      toast.error("Name and PIN are required");
      return;
    }
    const personPinError = pinError(personForm.pin);
    if (personPinError) {
      toast.error(personPinError);
      return;
    }
    setCreatingPerson(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eventId),
          type: personType,
          name: personForm.name,
          pin: personForm.pin,
        }),
      });
      if (res.ok) {
        toast.success(personType === "auditor" ? "Auditor created" : "Supervisor created");
        setPersonForm({ name: "", pin: "" });
        setPersonType(null);
        loadTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Failed to create ${personType}`);
      }
    } catch {
      toast.error(`Failed to create ${personType}`);
    } finally {
      setCreatingPerson(false);
    }
  };

  const bulkCreateTeams = async () => {
    const count = Number(bulkCount.trim());
    if (!bulkCount.trim() || !Number.isInteger(count) || count < 1 || count > 50) {
      toast.error("Enter how many teams to create (1 to 50)");
      return;
    }
    const basePinError = bulkPin ? pinError(bulkPin) : "Enter a base PIN";
    if (basePinError) {
      toast.error(basePinError);
      return;
    }
    // Sequential PINs keep the base PIN's width (leading zeros) and must stay valid
    const lastPin = String(parseInt(bulkPin, 10) + count - 1).padStart(bulkPin.length, "0");
    const lastPinError = pinError(lastPin);
    if (lastPinError) {
      toast.error(`Base PIN too high for ${plural(count, "team")}: ${lastPinError.toLowerCase()}`);
      return;
    }

    let created = 0;
    setBulkProgress({ current: 0, total: count, created: 0 });
    for (let i = 1; i <= count; i++) {
      const pin = String(parseInt(bulkPin, 10) + i - 1).padStart(bulkPin.length, "0");
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
    if (created === count) toast.success(`Created ${plural(created, "team")}`);
    else toast.error(`Created ${created} of ${count} teams. Check for duplicate names and try the rest again.`);
    setBulkProgress(null);
    setBulkOpen(false);
    setBulkPin("");
    setBulkCount("");
    loadTeams();
  };

  // Auditors live in the supervisors table, so they are deleted with type "supervisor";
  // `label` only changes the wording shown to the user.
  const handleDelete = (id: number, name: string, type: "team" | "supervisor", label: string = type) => {
    void confirm({
      title: `Delete ${label} "${name}"?`,
      description:
        type === "team" ? (
          <p>
            The team can no longer log in and its bins go back to the unassigned list. Any counts, queries and
            breakdowns it recorded are deleted too. This cannot be undone.
          </p>
        ) : (
          <p>This {label} can no longer log in to this stocktake.</p>
        ),
      confirmLabel: `Delete ${label}`,
      destructive: true,
      onConfirm: async () => {
        const res = await fetch("/api/admin/teams", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, type }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Delete failed");
        }
        toast.success(`${label.charAt(0).toUpperCase()}${label.slice(1)} deleted`);
        loadTeams();
      },
    });
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }
      setImportResult(data.summary);
      if (data.success) {
        toast.success(`${plural(Number(data.summary.teamsCreated) || 0, "team")} imported`);
        loadTeams();
      }
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const supervisorsOnly = supervisorsList.filter((s) => s.role !== "auditor");
  const auditors = supervisorsList.filter((s) => s.role === "auditor");

  const openPersonDialog = (type: PersonType) => {
    setPersonForm({ name: "", pin: "" });
    setPersonType(type);
  };

  return (
    <div className="space-y-6">
      <PeopleSection
        icon={Users}
        title="Counting teams"
        count={teamsList.length}
        description="Each team logs in with its own PIN and counts only the bins assigned to it."
        actions={
          !readOnly && (
            <Button variant="outline" size="sm" onClick={() => setShowPins((v) => !v)} aria-pressed={showPins}>
              {showPins ? <EyeOff /> : <Eye />}
              {showPins ? "Hide PINs" : "Show PINs"}
            </Button>
          )
        }
        footer={
          !readOnly && (
            <>
              <Button size="sm" onClick={() => { setAddTeamOpen(true); setTeamForm({ name: "", pin: "" }); setTeamMembers([""]); }}>
                <Plus />
                Add team
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                <Layers />
                Bulk create
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setImportOpen(true); setImportFile(null); setImportResult(null); }}>
                <Upload />
                Import from Excel
              </Button>
            </>
          )
        }
      >
        {teamsList.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {teamsList.map((team) => {
              const memberList = parseMembers(team.members);
              return (
                <li key={team.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{team.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {memberList.length > 0 ? memberList.join(", ") : "No members listed"}
                    </div>
                  </div>
                  {showPins && <PinChip pin={team.pinPlain} />}
                  <span className="text-xs tabular-nums text-slate-500">{plural(team.assignedItems, "item")}</span>
                  {!readOnly && (
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500" onClick={() => openEditDialog(team)} aria-label={`Edit ${team.name}`}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-500 hover:text-red-700"
                        onClick={() => handleDelete(team.id, team.name, "team")}
                        aria-label={`Delete ${team.name}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-slate-500">
            No teams yet.{!readOnly && " Add them one at a time, create a numbered batch, or import a list from Excel."}
          </p>
        )}
      </PeopleSection>

      <PeopleSection
        icon={Shield}
        title="Supervisors"
        count={supervisorsOnly.length}
        description="Supervisors watch progress, review variances, send recounts to another team and answer queries. You need at least one to go live."
        footer={
          canManagePeople && (
            <Button size="sm" onClick={() => openPersonDialog("supervisor")}>
              <Plus />
              Add supervisor
            </Button>
          )
        }
      >
        <PersonList
          people={supervisorsOnly}
          showPins={showPins}
          emptyText={canManagePeople ? "No supervisors yet. Add at least one before going live." : "No supervisors."}
          onDelete={canManagePeople ? (p) => handleDelete(p.id, p.name, "supervisor", "supervisor") : undefined}
        />
      </PeopleSection>

      <PeopleSection
        icon={ClipboardCheck}
        title="Auditors"
        count={auditors.length}
        description="Optional. Auditors see the supervisor screens read-only (progress, variances, results) and cannot change anything."
        footer={
          canManagePeople && (
            <Button size="sm" variant="outline" onClick={() => openPersonDialog("auditor")}>
              <Plus />
              Add auditor
            </Button>
          )
        }
      >
        <PersonList
          people={auditors}
          showPins={showPins}
          emptyText="No auditors. They are optional."
          onDelete={canManagePeople ? (p) => handleDelete(p.id, p.name, "supervisor", "auditor") : undefined}
        />
      </PeopleSection>

      <AddTeamDialog
        open={addTeamOpen}
        onClose={() => setAddTeamOpen(false)}
        form={teamForm}
        setForm={setTeamForm}
        members={teamMembers}
        setMembers={setTeamMembers}
        onCreate={createTeam}
        submitting={creatingTeam}
      />

      <EditTeamDialog
        open={!!editTeam}
        onClose={() => setEditTeam(null)}
        form={editForm}
        setForm={setEditForm}
        members={editMembers}
        setMembers={setEditMembers}
        onSave={saveEditTeam}
        submitting={savingTeam}
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

      <AddPersonDialog
        open={personType !== null}
        onClose={() => setPersonType(null)}
        title={personType === "auditor" ? "Add auditor" : "Add supervisor"}
        namePlaceholder={personType === "auditor" ? "Auditor name" : "Supervisor name"}
        submitLabel={personType === "auditor" ? "Create auditor" : "Create supervisor"}
        form={personForm}
        setForm={setPersonForm}
        onCreate={createPerson}
        submitting={creatingPerson}
      />

      {confirmDialog}
    </div>
  );
}

function PeopleSection({
  icon: Icon,
  title,
  count,
  description,
  actions,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  description: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
            {title}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{count}</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
        {actions || null}
      </header>
      {children}
      {footer ? <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">{footer}</div> : null}
    </section>
  );
}

function PinChip({ pin }: { pin?: string | null }) {
  return pin ? (
    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs tabular-nums text-slate-700">PIN {pin}</span>
  ) : (
    <span className="text-xs text-slate-400">PIN hidden</span>
  );
}

function PersonList({
  people,
  showPins,
  emptyText,
  onDelete,
}: {
  people: SupervisorInfo[];
  showPins: boolean;
  emptyText: string;
  onDelete?: (person: SupervisorInfo) => void;
}) {
  if (people.length === 0) return <p className="px-4 py-6 text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {people.map((p) => (
        <li key={p.id} className="flex items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{p.name}</div>
          {showPins && <PinChip pin={p.pinPlain} />}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-red-700"
              onClick={() => onDelete(p)}
              aria-label={`Delete ${p.name}`}
            >
              <Trash2 />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
