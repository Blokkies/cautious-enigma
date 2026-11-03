"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EVENT_LOCATION_MAX, EVENT_NAME_MAX, validateEventDetails, type EventDetails } from "@/lib/event-details";
import { useAdminEvent } from "../event-context";

export interface EventDetailsValues {
  name: string;
  location: string;
  startDate: string;
  endDate: string;
}

export function toFormValues(e?: Partial<EventDetails> | null): EventDetailsValues {
  return {
    name: e?.name ?? "",
    location: e?.location ?? "",
    startDate: e?.startDate?.slice(0, 10) ?? "",
    endDate: e?.endDate?.slice(0, 10) ?? "",
  };
}

/**
 * Name / location / dates form, shared by the wizard's first step and the edit dialog.
 * `onSubmit` throws to show an error under the form.
 */
export function EventDetailsForm({
  initial,
  submitLabel,
  onSubmit,
  secondary,
  autoFocus = false,
}: {
  initial: EventDetailsValues;
  submitLabel: string;
  onSubmit: (values: EventDetailsValues) => Promise<void>;
  /** Extra buttons left of submit (Cancel, Save & exit...). */
  secondary?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof EventDetailsValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const check = validateEventDetails({
      name: values.name,
      location: values.location,
      startDate: values.startDate,
      endDate: values.endDate,
    });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ ...values, name: values.name.trim(), location: values.location.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={values.name}
          onChange={set("name")}
          maxLength={EVENT_NAME_MAX}
          placeholder="e.g. Durban DC year-end 2026"
          autoFocus={autoFocus}
          required
          aria-invalid={!!error && !values.name.trim()}
        />
        <p className="text-xs text-slate-500">Teams pick this name from a list when they log in.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-location`}>
          Location <span className="font-normal text-slate-500">(optional)</span>
        </Label>
        <Input
          id={`${id}-location`}
          value={values.location}
          onChange={set("location")}
          maxLength={EVENT_LOCATION_MAX}
          placeholder="e.g. Durban distribution centre"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-start`}>
            Start date <span className="font-normal text-slate-500">(optional)</span>
          </Label>
          <Input id={`${id}-start`} type="date" value={values.startDate} onChange={set("startDate")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-end`}>
            End date <span className="font-normal text-slate-500">(optional)</span>
          </Label>
          <Input id={`${id}-end`} type="date" value={values.endDate} min={values.startDate || undefined} onChange={set("endDate")} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {secondary}
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** PUT the details of an event; throws with the server's message on failure. */
export async function saveEventDetails(id: number, values: EventDetailsValues): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/admin/events", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: values.name,
        location: values.location,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
      }),
    });
  } catch {
    throw new Error("Could not reach the server. Nothing was saved.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not save (HTTP ${res.status}).`);
  }
}

/** Edit name, location and dates of the current event. Works in any status. */
export function EditEventDetailsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { event, reload } = useAdminEvent();
  if (!event) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>You can change these at any time, even while counting is live.</DialogDescription>
        </DialogHeader>
        {open && (
          <EventDetailsForm
            initial={toFormValues(event)}
            submitLabel="Save details"
            autoFocus
            secondary={
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            }
            onSubmit={async (values) => {
              await saveEventDetails(event.id, values);
              await reload();
              toast.success("Details saved");
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
