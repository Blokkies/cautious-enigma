"use client";

import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Plus, Loader2, X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, sanitizePinInput } from "./pin";
import { plural } from "@/lib/format";

type NamePinForm = { name: string; pin: string };

export interface BulkProgress {
  current: number;
  total: number;
  created: number;
}

export interface ImportResult {
  teamsCreated: number;
  teamsSkipped: number;
  totalRows: number;
  errors: string[];
}

function MembersEditor({
  members,
  setMembers,
}: {
  members: string[];
  setMembers: Dispatch<SetStateAction<string[]>>;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Members</div>
      {members.map((member, i) => (
        <div key={i} className="flex gap-2">
          <Input
            placeholder={`Member ${i + 1}`}
            value={member}
            onChange={(e) => setMembers(prev => prev.map((m, j) => j === i ? e.target.value : m))}
          />
          {members.length > 1 && (
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setMembers(prev => prev.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setMembers(prev => [...prev, ""])} className="gap-1">
        <Plus className="h-3 w-3" /> Add Member
      </Button>
    </div>
  );
}

export function AddTeamDialog({
  open,
  onClose,
  form,
  setForm,
  members,
  setMembers,
  onCreate,
  submitting = false,
}: {
  open: boolean;
  onClose: () => void;
  form: NamePinForm;
  setForm: Dispatch<SetStateAction<NamePinForm>>;
  members: string[];
  setMembers: Dispatch<SetStateAction<string[]>>;
  onCreate: () => void;
  /** Disables the submit button while the request is in flight (no double submit). */
  submitting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Team</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Team name"
            value={form.name}
            onChange={(e) =>
              setForm((p) => ({ ...p, name: e.target.value }))
            }
          />
          <Input
            placeholder={`PIN (${PIN_MIN_LENGTH}+ digits)`}
            type="password"
            inputMode="numeric"
            maxLength={PIN_MAX_LENGTH}
            value={form.pin}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                pin: sanitizePinInput(e.target.value),
              }))
            }
          />
          <MembersEditor members={members} setMembers={setMembers} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={submitting} className="gap-1">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Creating..." : "Create Team"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditTeamDialog({
  open,
  onClose,
  form,
  setForm,
  members,
  setMembers,
  onSave,
  submitting = false,
}: {
  open: boolean;
  onClose: () => void;
  form: NamePinForm;
  setForm: Dispatch<SetStateAction<NamePinForm>>;
  members: string[];
  setMembers: Dispatch<SetStateAction<string[]>>;
  onSave: () => void;
  submitting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Team</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Team name"
            value={form.name}
            onChange={(e) =>
              setForm((p) => ({ ...p, name: e.target.value }))
            }
          />
          <MembersEditor members={members} setMembers={setMembers} />
          <Input
            placeholder={`New PIN (${PIN_MIN_LENGTH}+ digits, leave empty to keep current)`}
            type="password"
            inputMode="numeric"
            maxLength={PIN_MAX_LENGTH}
            value={form.pin}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                pin: sanitizePinInput(e.target.value),
              }))
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={submitting} className="gap-1">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BulkCreateDialog({
  open,
  setOpen,
  prefix,
  setPrefix,
  count,
  setCount,
  pin,
  setPin,
  progress,
  onCreate,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  prefix: string;
  setPrefix: (v: string) => void;
  count: string;
  setCount: (v: string) => void;
  pin: string;
  setPin: (v: string) => void;
  progress: BulkProgress | null;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!progress) setOpen(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Create Teams</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Prefix</label>
              <Input
                placeholder="e.g. Team"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                disabled={!!progress}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Count</label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                step={1}
                placeholder="e.g. 10"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                disabled={!!progress}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Base PIN</label>
            <Input
              placeholder="e.g. 1001"
              inputMode="numeric"
              maxLength={PIN_MAX_LENGTH}
              value={pin}
              onChange={(e) => setPin(sanitizePinInput(e.target.value))}
              disabled={!!progress}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Creates {prefix} 1, {prefix} 2, ... {prefix} {count.trim() || "N"} (up to 50) with sequential PINs starting from {pin || "____"}.
          </p>

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating teams...
                </span>
                <span className="text-muted-foreground">
                  {progress.current}/{progress.total}
                </span>
              </div>
              <Progress value={Math.round((progress.current / progress.total) * 100)} className="h-3" />
              <p className="text-xs text-muted-foreground text-center">
                {progress.created} created successfully
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={!!progress}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={!!progress} className="gap-1">
              {progress ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
              ) : (
                <><Plus className="h-4 w-4" /> Create Teams</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImportTeamsDialog({
  open,
  setOpen,
  importFile,
  onFileChange,
  importing,
  importResult,
  onDownloadTemplate,
  onImport,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  importFile: File | null;
  onFileChange: (file: File | null) => void;
  importing: boolean;
  importResult: ImportResult | null;
  onDownloadTemplate: () => void;
  onImport: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!importing) setOpen(open); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Teams from Excel
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Upload an Excel file with columns: <strong>Team Name</strong>, <strong>PIN</strong>, and optionally <strong>Members</strong> (comma-separated).
          </div>

          <Button variant="outline" size="sm" onClick={onDownloadTemplate} className="gap-1">
            <Download className="h-4 w-4" />
            Download Template
          </Button>

          <div>
            <label className="text-sm font-medium mb-1 block">Select File</label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => onFileChange(e.target.files?.[0] || null)}
              disabled={importing}
            />
          </div>

          {importResult && (
            <div className="space-y-2">
              {importResult.teamsCreated > 0 && (
                <div className="flex items-start gap-2 p-3 bg-green-50 text-green-800 rounded-lg text-sm">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{plural(importResult.teamsCreated, "team")} created successfully</div>
                    {importResult.teamsSkipped > 0 && (
                      <div className="text-green-600">{importResult.teamsSkipped} skipped (already exist)</div>
                    )}
                  </div>
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="p-3 bg-red-50 text-red-800 rounded-lg text-sm">
                  <div className="flex items-center gap-1 font-medium mb-1">
                    <AlertCircle className="h-4 w-4" />
                    {importResult.errors.length} issue(s)
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={importing}>
              {importResult ? "Close" : "Cancel"}
            </Button>
            {!importResult?.teamsCreated && (
              <Button onClick={onImport} disabled={importing || !importFile} className="gap-1">
                {importing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Importing...</>
                ) : (
                  <><Upload className="h-4 w-4" /> Import</>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Name + PIN dialog used for adding supervisors and auditors. */
export function AddPersonDialog({
  open,
  onClose,
  title,
  namePlaceholder,
  submitLabel,
  form,
  setForm,
  onCreate,
  submitting = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  namePlaceholder: string;
  submitLabel: string;
  form: NamePinForm;
  setForm: Dispatch<SetStateAction<NamePinForm>>;
  onCreate: () => void;
  submitting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder={namePlaceholder}
            value={form.name}
            onChange={(e) =>
              setForm((p) => ({ ...p, name: e.target.value }))
            }
          />
          <Input
            placeholder={`PIN (${PIN_MIN_LENGTH}+ digits)`}
            type="password"
            inputMode="numeric"
            maxLength={PIN_MAX_LENGTH}
            value={form.pin}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                pin: sanitizePinInput(e.target.value),
              }))
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={submitting} className="gap-1">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
