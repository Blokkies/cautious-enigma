"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload,
  Users,
  FileSpreadsheet,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Map,
  Play,
  Check,
  Circle,
  X,
  AlertTriangle,
  ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";

// --- Types ---
interface EventInfo {
  id: number;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  status: string;
  itemCount: number;
  totalItemCount: number;
  teamCount: number;
  supervisorCount: number;
}

interface ImportSummary {
  totalItems: number;
  uniqueBins: number;
  uniqueBrands: number;
  totalValue: number;
  warehouses?: string[];
}

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

interface Readiness {
  hasItems: boolean;
  hasTeams: boolean;
  hasSupervisors: boolean;
  allItemsAssigned: boolean;
  unassignedCount: number;
}

type WizardStep = "details" | "import" | "teams" | "review";

const WIZARD_STEPS: { key: WizardStep; label: string; num: number }[] = [
  { key: "details", label: "Event", num: 1 },
  { key: "import", label: "Import", num: 2 },
  { key: "teams", label: "Teams", num: 3 },
  { key: "review", label: "Review", num: 4 },
];

// --- Step Indicator ---
function StepIndicator({
  currentStep,
  completedSteps,
}: {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
}) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {WIZARD_STEPS.map((step, i) => {
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps.has(step.key);
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors",
                  isCurrent
                    ? "border-primary bg-primary text-white"
                    : isCompleted
                      ? "border-green-500 bg-green-500 text-white"
                      : "border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {isCompleted && !isCurrent ? (
                  <Check className="h-4 w-4" />
                ) : (
                  step.num
                )}
              </div>
              <span
                className={cn(
                  "text-xs mt-1",
                  isCurrent
                    ? "text-primary font-medium"
                    : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div
                className={cn(
                  "w-8 h-0.5 mx-1 mb-5",
                  isCompleted ? "bg-green-500" : "bg-muted-foreground/20"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Main Component ---
export default function AdminSetup() {
  // Event list state
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("details");
  const [wizardEventId, setWizardEventId] = useState<number | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(
    new Set()
  );

  // Step 1: Event details
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    location: "",
    startDate: "",
    endDate: "",
  });

  // Step 2: Import
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null
  );
  const [selectedWarehouses, setSelectedWarehouses] = useState<Set<string>>(new Set());

  // Step 3: Teams
  const [teamsList, setTeamsList] = useState<TeamInfo[]>([]);
  const [supervisorsList, setSupervisorsList] = useState<SupervisorInfo[]>([]);
  const [teamForm, setTeamForm] = useState({
    name: "",
    member1: "",
    member2: "",
    pin: "",
  });
  const [supForm, setSupForm] = useState({ name: "", pin: "" });
  const [addingTeam, setAddingTeam] = useState(false);
  const [addingSupervisor, setAddingSupervisor] = useState(false);

  // Step 4: Review
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [activating, setActivating] = useState(false);

  // --- Data loading ---
  const loadEvents = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const loadTeams = useCallback(async () => {
    if (!wizardEventId) return;
    try {
      const res = await fetch(`/api/admin/teams?eventId=${wizardEventId}`);
      if (res.ok) {
        const data = await res.json();
        setTeamsList(data.teams || []);
        setSupervisorsList(data.supervisors || []);
      }
    } catch {
      toast.error("Failed to load teams");
    }
  }, [wizardEventId]);

  const loadReadiness = useCallback(async () => {
    if (!wizardEventId) return;
    try {
      const res = await fetch(
        `/api/admin/activate?eventId=${wizardEventId}`
      );
      if (res.ok) {
        const data = await res.json();
        setReadiness(data);
      }
    } catch {
      toast.error("Failed to check readiness");
    }
  }, [wizardEventId]);

  // Load data when wizard step changes
  useEffect(() => {
    if (wizardStep === "teams" && wizardEventId) loadTeams();
    if (wizardStep === "review" && wizardEventId) loadReadiness();
  }, [wizardStep, wizardEventId, loadTeams, loadReadiness]);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    eventId: number;
    eventName: string;
    newStatus: string;
    title: string;
    message: string;
    confirmLabel: string;
    variant: "default" | "destructive";
  } | null>(null);

  // --- Event status helpers ---
  const statusColors: Record<string, string> = {
    setup: "bg-blue-100 text-blue-800",
    active: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    locked: "bg-red-100 text-red-800",
  };

  const doStatusChange = async (eventId: number, newStatus: string) => {
    try {
      const res = await fetch("/api/admin/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: eventId, status: newStatus }),
      });
      if (res.ok) {
        toast.success(`Event status changed to ${newStatus}`);
        loadEvents();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update status");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleStatusChange = (eventId: number, newStatus: string) => {
    const event = events.find((e) => e.id === eventId);
    const eventName = event?.name || "this event";

    if (newStatus === "completed") {
      setConfirmDialog({
        open: true,
        eventId,
        eventName,
        newStatus,
        title: "Complete Stocktake?",
        message:
          "This will lock the count. Teams and supervisors will no longer be able to submit counts, queries, or breakdowns. You can reopen the event later if needed.",
        confirmLabel: "Complete & Lock Counting",
        variant: "destructive",
      });
      return;
    }

    if (newStatus === "locked") {
      setConfirmDialog({
        open: true,
        eventId,
        eventName,
        newStatus,
        title: "Lock Event?",
        message:
          "Locking prevents any further changes including status changes by supervisors. This is typically done after final export.",
        confirmLabel: "Lock Event",
        variant: "destructive",
      });
      return;
    }

    // Non-destructive transitions (activate, reopen) — just do it
    doStatusChange(eventId, newStatus);
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmDialog) return;
    await doStatusChange(confirmDialog.eventId, confirmDialog.newStatus);
    setConfirmDialog(null);
  };

  const getStatusAction = (
    status: string
  ): {
    label: string;
    next: string;
    variant: "default" | "outline" | "destructive";
  } | null => {
    switch (status) {
      case "setup":
        return { label: "Activate", next: "active", variant: "default" };
      case "active":
        return { label: "Complete", next: "completed", variant: "destructive" };
      case "completed":
        return { label: "Lock", next: "locked", variant: "destructive" };
      case "locked":
        return { label: "Reopen", next: "active", variant: "outline" };
      default:
        return null;
    }
  };

  // --- Wizard actions ---
  const openWizard = () => {
    setWizardOpen(true);
    setWizardStep("details");
    setWizardEventId(null);
    setCompletedSteps(new Set());
    setForm({ name: "", location: "", startDate: "", endDate: "" });
    setFile(null);
    setImportSummary(null);
    setTeamsList([]);
    setSupervisorsList([]);
    setReadiness(null);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    loadEvents();
  };

  const markComplete = (step: WizardStep) => {
    setCompletedSteps((prev) => new Set(prev).add(step));
  };

  const goToStep = (step: WizardStep) => {
    setWizardStep(step);
  };

  // Step 1: Create event
  const handleCreateEvent = async () => {
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
        const data = await res.json();
        toast.success("Event created");
        setWizardEventId(data.event?.id || data.id);
        markComplete("details");
        goToStep("import");
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

  // Step 2: Import file
  const handleImport = async () => {
    if (!file || !wizardEventId) {
      toast.error("Please select a file");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("eventId", String(wizardEventId));
      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setImportSummary(data.summary);
        // Auto-select all warehouses found in the import
        if (data.summary.warehouses?.length > 0) {
          setSelectedWarehouses(new Set(data.summary.warehouses));
        }
        toast.success(`Imported ${data.summary.totalItems} items`);
        markComplete("import");
      } else {
        toast.error(data.error || "Import failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Step 3: Add team/supervisor
  const handleAddTeam = async () => {
    if (!teamForm.name.trim() || !teamForm.pin || teamForm.pin.length < 4) {
      toast.error("Team name and 4+ digit PIN required");
      return;
    }
    setAddingTeam(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: wizardEventId,
          type: "team",
          name: teamForm.name.trim(),
          member1: teamForm.member1.trim() || null,
          member2: teamForm.member2.trim() || null,
          pin: teamForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Team added");
        setTeamForm({ name: "", member1: "", member2: "", pin: "" });
        loadTeams();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to add team");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAddingTeam(false);
    }
  };

  const handleAddSupervisor = async () => {
    if (!supForm.name.trim() || !supForm.pin || supForm.pin.length < 4) {
      toast.error("Name and 4+ digit PIN required");
      return;
    }
    setAddingSupervisor(true);
    try {
      const res = await fetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: wizardEventId,
          type: "supervisor",
          name: supForm.name.trim(),
          pin: supForm.pin,
        }),
      });
      if (res.ok) {
        toast.success("Supervisor added");
        setSupForm({ name: "", pin: "" });
        loadTeams();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to add supervisor");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAddingSupervisor(false);
    }
  };

  const handleDeleteTeamOrSup = async (
    id: number,
    type: "team" | "supervisor"
  ) => {
    try {
      const res = await fetch("/api/admin/teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type }),
      });
      if (res.ok) {
        toast.success(`${type === "team" ? "Team" : "Supervisor"} removed`);
        loadTeams();
      }
    } catch {
      toast.error("Network error");
    }
  };

  // Step 4: Activate
  const handleActivate = async () => {
    setActivating(true);
    try {
      const res = await fetch("/api/admin/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: wizardEventId }),
      });
      if (res.ok) {
        toast.success("Event activated!");
        markComplete("review");
        closeWizard();
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

  // --- Render ---
  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Event Setup</h1>
        {!wizardOpen && (
          <Button onClick={openWizard} className="gap-1">
            <Plus className="h-4 w-4" />
            Create New Event
          </Button>
        )}
      </div>

      {/* ── Wizard ── */}
      {wizardOpen && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>New Stocktake Event</CardTitle>
              <Button variant="ghost" size="sm" onClick={closeWizard}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <StepIndicator
              currentStep={wizardStep}
              completedSteps={completedSteps}
            />

            {/* Step 1: Event Details */}
            {wizardStep === "details" && (
              <div className="space-y-4">
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
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleCreateEvent}
                    disabled={creating}
                    className="gap-1"
                  >
                    {creating ? "Creating..." : "Create & Continue"}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Import */}
            {wizardStep === "import" && (
              <div className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="wizard-file-upload"
                  />
                  <label
                    htmlFor="wizard-file-upload"
                    className="cursor-pointer flex flex-col items-center gap-2"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    {file ? (
                      <span className="font-medium text-primary">
                        {file.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Click to select Excel file
                      </span>
                    )}
                  </label>
                </div>

                {file && (
                  <Button
                    onClick={handleImport}
                    disabled={uploading}
                    className="w-full h-12"
                  >
                    {uploading ? "Importing..." : "Import Data"}
                  </Button>
                )}

                {importSummary && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2 text-green-800 font-medium">
                      <CheckCircle2 className="h-4 w-4" />
                      Import Complete
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="font-bold text-green-800">
                          {importSummary.totalItems.toLocaleString()}
                        </span>{" "}
                        items
                      </div>
                      <div>
                        <span className="font-bold text-green-800">
                          {importSummary.uniqueBins}
                        </span>{" "}
                        bins
                      </div>
                      <div>
                        <span className="font-bold text-green-800">
                          {importSummary.uniqueBrands}
                        </span>{" "}
                        brands
                      </div>
                      <div>
                        <span className="font-bold text-green-800">
                          R
                          {importSummary.totalValue.toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </span>{" "}
                        value
                      </div>
                    </div>
                  </div>
                )}

                {importSummary && importSummary.warehouses && importSummary.warehouses.length > 1 && (
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Map className="h-4 w-4" />
                      Warehouse Selection
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Only items from selected warehouses will be included in this event.
                    </p>
                    <div className="space-y-2">
                      {importSummary.warehouses.map((wh) => (
                        <label
                          key={wh}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedWarehouses.has(wh)}
                            onChange={() => {
                              setSelectedWarehouses((prev) => {
                                const next = new Set(prev);
                                if (next.has(wh)) next.delete(wh);
                                else next.add(wh);
                                return next;
                              });
                            }}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span className="text-sm">{wh}</span>
                        </label>
                      ))}
                    </div>
                    {selectedWarehouses.size === 0 && (
                      <p className="text-xs text-amber-600 font-medium">
                        Select at least one warehouse to continue.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <Button
                    variant="outline"
                    onClick={() => goToStep("details")}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    {!importSummary && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          goToStep("teams");
                        }}
                      >
                        Skip for now
                      </Button>
                    )}
                    {importSummary && (
                      <Button
                        onClick={async () => {
                          // Save warehouse selection if multiple warehouses exist
                          if (importSummary.warehouses && importSummary.warehouses.length > 1 && wizardEventId) {
                            await fetch("/api/admin/events", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                id: wizardEventId,
                                warehouses: Array.from(selectedWarehouses),
                              }),
                            });
                          }
                          markComplete("import");
                          goToStep("teams");
                        }}
                        disabled={importSummary.warehouses && importSummary.warehouses.length > 1 && selectedWarehouses.size === 0}
                        className="gap-1"
                      >
                        Continue
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Teams & Supervisors */}
            {wizardStep === "teams" && (
              <div className="space-y-4">
                {/* Teams section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 font-medium">
                    <Users className="h-4 w-4" />
                    Teams ({teamsList.length})
                  </div>

                  {teamsList.map((team) => (
                    <div
                      key={team.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <span className="font-medium">{team.name}</span>
                        {(team.member1 || team.member2) && (
                          <span className="text-sm text-muted-foreground ml-2">
                            ({[team.member1, team.member2]
                              .filter(Boolean)
                              .join(", ")})
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteTeamOrSup(team.id, "team")}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  {/* Add team form */}
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={teamForm.name}
                        onChange={(e) =>
                          setTeamForm((p) => ({ ...p, name: e.target.value }))
                        }
                        placeholder="Team name"
                        className="h-10"
                      />
                      <Input
                        value={teamForm.pin}
                        onChange={(e) =>
                          setTeamForm((p) => ({
                            ...p,
                            pin: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        placeholder="PIN (4+ digits)"
                        maxLength={6}
                        className="h-10"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={teamForm.member1}
                        onChange={(e) =>
                          setTeamForm((p) => ({
                            ...p,
                            member1: e.target.value,
                          }))
                        }
                        placeholder="Member 1 (optional)"
                        className="h-10"
                      />
                      <Input
                        value={teamForm.member2}
                        onChange={(e) =>
                          setTeamForm((p) => ({
                            ...p,
                            member2: e.target.value,
                          }))
                        }
                        placeholder="Member 2 (optional)"
                        className="h-10"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleAddTeam}
                      disabled={addingTeam}
                      className="gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      {addingTeam ? "Adding..." : "Add Team"}
                    </Button>
                  </div>
                </div>

                {/* Supervisors section */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2 font-medium">
                    <FileSpreadsheet className="h-4 w-4" />
                    Supervisors ({supervisorsList.length})
                  </div>

                  {supervisorsList.map((sup) => (
                    <div
                      key={sup.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <span className="font-medium">{sup.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleDeleteTeamOrSup(sup.id, "supervisor")
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={supForm.name}
                        onChange={(e) =>
                          setSupForm((p) => ({ ...p, name: e.target.value }))
                        }
                        placeholder="Supervisor name"
                        className="h-10"
                      />
                      <Input
                        value={supForm.pin}
                        onChange={(e) =>
                          setSupForm((p) => ({
                            ...p,
                            pin: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        placeholder="PIN (4+ digits)"
                        maxLength={6}
                        className="h-10"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleAddSupervisor}
                      disabled={addingSupervisor}
                      className="gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      {addingSupervisor ? "Adding..." : "Add Supervisor"}
                    </Button>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <Button
                    variant="outline"
                    onClick={() => goToStep("import")}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    {teamsList.length === 0 && supervisorsList.length === 0 && (
                      <Button
                        variant="ghost"
                        onClick={() => goToStep("review")}
                      >
                        Skip for now
                      </Button>
                    )}
                    {(teamsList.length > 0 ||
                      supervisorsList.length > 0) && (
                      <Button
                        onClick={() => {
                          markComplete("teams");
                          goToStep("review");
                        }}
                        className="gap-1"
                      >
                        Continue
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Review & Activate */}
            {wizardStep === "review" && (
              <div className="space-y-4">
                <div className="font-medium">Readiness Checklist</div>

                {readiness ? (
                  <div className="space-y-2">
                    <ReadinessItem
                      ok={readiness.hasItems}
                      label="Items imported"
                    />
                    <ReadinessItem
                      ok={readiness.hasTeams}
                      label="Teams created"
                    />
                    <ReadinessItem
                      ok={readiness.hasSupervisors}
                      label="Supervisors created"
                    />
                    <ReadinessItem
                      ok={readiness.allItemsAssigned}
                      label={
                        readiness.allItemsAssigned
                          ? "All items assigned to teams"
                          : `${readiness.unassignedCount} items unassigned`
                      }
                    />

                    {!readiness.allItemsAssigned &&
                      readiness.hasItems &&
                      readiness.hasTeams && (
                        <div className="pt-1">
                          <Link
                            href="/admin/teams/assign"
                            className="text-sm text-primary hover:underline"
                          >
                            Go to Assign page to assign items to teams
                          </Link>
                        </div>
                      )}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Loading readiness...
                  </div>
                )}

                <div className="flex justify-between pt-4">
                  <Button
                    variant="outline"
                    onClick={() => goToStep("teams")}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={closeWizard}>
                      Finish Later
                    </Button>
                    {readiness?.hasItems &&
                      readiness?.hasTeams &&
                      readiness?.hasSupervisors && (
                        <Button
                          onClick={handleActivate}
                          disabled={activating}
                          className="gap-1"
                        >
                          <Play className="h-4 w-4" />
                          {activating ? "Activating..." : "Activate Event"}
                        </Button>
                      )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Existing Events List ── */}
      {events.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">Your Events</h2>
          {events.map((event) => {
            const action = getStatusAction(event.status);
            return (
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
                    </div>
                    <Badge className={statusColors[event.status] || ""}>
                      {event.status}
                    </Badge>
                  </div>

                  {/* Stats row */}
                  <div className="flex gap-4 mt-3 text-sm text-muted-foreground">
                    <span>{event.itemCount} items</span>
                    <span>{event.teamCount} teams</span>
                    <span>{event.supervisorCount} supervisors</span>
                  </div>

                  {/* Manage section */}
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Manage
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/admin/import?eventId=${event.id}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Upload className="h-3.5 w-3.5" />
                          Import
                        </Button>
                      </Link>
                      <Link href={`/admin/teams?eventId=${event.id}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          Teams
                        </Button>
                      </Link>
                      <Link href={`/admin/teams/assign?eventId=${event.id}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <Map className="h-3.5 w-3.5" />
                          Assign
                        </Button>
                      </Link>
                      <Link href={`/admin/activate?eventId=${event.id}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Readiness
                        </Button>
                      </Link>
                      <Link href={`/admin/summary?eventId=${event.id}`}>
                        <Button variant="outline" size="sm" className="gap-1.5">
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          Summary
                        </Button>
                      </Link>
                      {action && (
                        <Button
                          size="sm"
                          variant={action.variant}
                          onClick={() =>
                            handleStatusChange(event.id, action.next)
                          }
                          className="gap-1.5"
                        >
                          <Play className="h-3.5 w-3.5" />
                          {action.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {events.length === 0 && !wizardOpen && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-muted-foreground mb-4">
              No events yet. Create your first stocktake event to get started.
            </div>
            <Button onClick={openWizard} className="gap-1">
              <Plus className="h-4 w-4" />
              Create New Event
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog
        open={!!confirmDialog?.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {confirmDialog?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="font-medium">{confirmDialog?.eventName}</div>
            <p className="text-sm text-muted-foreground">
              {confirmDialog?.message}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setConfirmDialog(null)}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog?.variant || "default"}
              onClick={handleConfirmStatusChange}
            >
              {confirmDialog?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Readiness check item ---
function ReadinessItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={ok ? "text-green-800" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}
