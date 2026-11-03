"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber } from "@/lib/format";
import { useAdminEvent } from "../event-context";
import { statusMeta } from "../status";
import { ListSkeleton } from "../loading-state";
import { ErrorState } from "../error-state";
import { EmptyState } from "../empty-state";
import { InfoNote, PanelSection, ReadOnlyNotice } from "./panel-section";
import { useItemsOverview, type ItemsOverview } from "./use-event-data";

/** The saved selection as a set (null on the server = every warehouse). */
function savedSelection(data: ItemsOverview): Set<string> {
  const all = data.warehouses.map((w) => w.warehouse);
  if (!data.selectedWarehouses) return new Set(all);
  return new Set(all.filter((w) => data.selectedWarehouses!.includes(w)));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * Choose which warehouses of the stock file are counted. Editable only during setup.
 * `onDirtyChange` reports unsaved changes (the wizard blocks Continue on them).
 */
export function WarehousesPanel({
  onChanged,
  onDirtyChange,
  hideWhenEmpty = false,
}: {
  onChanged?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Render nothing (instead of an empty state) before items are imported. */
  hideWhenEmpty?: boolean;
}) {
  const { event, reload: reloadEvent } = useAdminEvent();
  const eventId = event!.id;
  const inSetup = event!.status === "setup";
  const overview = useItemsOverview(eventId);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  const saved = useMemo(() => (overview.data ? savedSelection(overview.data) : null), [overview.data]);
  const current = selected ?? saved;
  const dirty = !!current && !!saved && !sameSet(current, saved);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  if (overview.loading) return <ListSkeleton rows={3} />;
  if (overview.error && !overview.data) {
    return <ErrorState title="Could not load the warehouses" message={overview.error} onRetry={() => void overview.reload()} />;
  }
  const data = overview.data!;
  if (data.warehouses.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <EmptyState
        icon={Warehouse}
        title="No warehouses yet"
        description="Warehouses come from the stock file. Import it first, then choose which warehouses to count."
      />
    );
  }

  const all = data.warehouses.map((w) => w.warehouse);
  const chosen = current ?? new Set<string>();
  const chosenStats = data.warehouses.filter((w) => chosen.has(w.warehouse));
  const totals = chosenStats.reduce(
    (t, w) => ({ items: t.items + w.itemCount, value: t.value + w.totalValue }),
    { items: 0, value: 0 }
  );

  const toggle = (w: string) => {
    const next = new Set(chosen);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    setSelected(next);
  };

  const save = async () => {
    if (chosen.size === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Keep the file's order so the stored list is stable
        body: JSON.stringify({ id: eventId, warehouses: all.filter((w) => chosen.has(w)) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Could not save the warehouse selection");
        return;
      }
      toast.success("Warehouse selection saved");
      await overview.reload();
      setSelected(null);
      void reloadEvent();
      onChanged?.();
    } catch {
      toast.error("Could not reach the server. The selection was not saved.");
    } finally {
      setSaving(false);
    }
  };

  const single = data.warehouses.length === 1;

  return (
    <div className="space-y-4">
      {!inSetup && (
        <ReadOnlyNotice>
          The warehouse selection is locked because this stocktake is{" "}
          <strong>{statusMeta(event!.status).label.toLowerCase()}</strong>. It defines what is being counted.
        </ReadOnlyNotice>
      )}
      {single && inSetup && (
        <InfoNote>The stock file has one warehouse, so there is nothing to choose. All its items are counted.</InfoNote>
      )}

      <PanelSection
        title="Warehouses in this stocktake"
        description="Only items in ticked warehouses are counted, assigned to teams and reported. Unticked warehouses stay in the file but are ignored."
        actions={
          inSetup &&
          !single && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(all))} disabled={chosen.size === all.length}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={chosen.size === 0}>
                Select none
              </Button>
            </div>
          )
        }
        bodyClassName="p-0 sm:p-0"
      >
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {data.warehouses.map((w) => {
            const on = chosen.has(w.warehouse);
            const id = `wh-${w.warehouse}`;
            return (
              <li key={w.warehouse}>
                <label
                  htmlFor={id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 sm:px-5",
                    inSetup && !single ? "cursor-pointer hover:bg-slate-50" : "cursor-default",
                    !on && "text-slate-400"
                  )}
                >
                  <Checkbox id={id} checked={on} onCheckedChange={() => toggle(w.warehouse)} disabled={!inSetup || single} />
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", on ? "text-slate-900" : "text-slate-500")}>
                    {w.warehouse}
                  </span>
                  <span className="hidden text-xs tabular-nums text-slate-500 sm:inline">{formatNumber(w.binCount)} bins</span>
                  <span className="w-24 text-right text-xs tabular-nums text-slate-500">{formatNumber(w.itemCount)} items</span>
                  <span className="hidden w-28 text-right text-xs tabular-nums text-slate-500 sm:inline">
                    {formatMoney(w.totalValue, { decimals: 0 })}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
          <p className="text-sm text-slate-600">
            {chosen.size === 0 ? (
              <span className="text-red-700">Select at least one warehouse.</span>
            ) : (
              <>
                <span className="font-medium tabular-nums text-slate-900">{chosen.size}</span> of {all.length} selected:{" "}
                <span className="tabular-nums">{formatNumber(totals.items)}</span> items,{" "}
                <span className="tabular-nums">{formatMoney(totals.value, { decimals: 0 })}</span>
              </>
            )}
          </p>
          {inSetup && !single && (
            <div className="flex items-center gap-3">
              {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
              <Button size="sm" onClick={() => void save()} disabled={!dirty || chosen.size === 0 || saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save selection
              </Button>
            </div>
          )}
        </div>
      </PanelSection>
    </div>
  );
}
