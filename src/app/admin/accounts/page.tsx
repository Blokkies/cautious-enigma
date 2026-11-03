"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, KeyRound, Plus, Trash2, UserCog, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/admin/page-header";
import { ErrorState } from "@/components/admin/error-state";
import { ListSkeleton } from "@/components/admin/loading-state";
import { useConfirm } from "@/components/admin/confirm-dialog";
import { parseTimestamp } from "@/components/admin/event-list";
import { formatDate } from "@/lib/format";

interface Account {
  id: number;
  name: string;
  createdAt: string;
}

type Kind = "admin" | "executive";

const KIND: Record<
  Kind,
  { title: string; noun: string; icon: LucideIcon; api: string; listKey: string; description: string; deleteNote: string }
> = {
  admin: {
    title: "Admins",
    noun: "admin",
    icon: UserCog,
    api: "/api/admin/admins",
    listKey: "admins",
    description:
      "Full control: create stocktakes, import stock, manage people and bins, change statuses, export to NetSuite and manage these accounts.",
    deleteNote: "They will no longer be able to log in to the admin area.",
  },
  executive: {
    title: "Executives",
    noun: "executive",
    icon: Briefcase,
    api: "/api/admin/executives",
    listKey: "executives",
    description:
      "Read-only: the executive dashboard with progress and variance values across stocktakes, read-only variances, exports, and messages to supervisors.",
    deleteNote: "They will no longer be able to log in to the executive dashboard.",
  },
};

function createdOn(value: string): string {
  const d = parseTimestamp(value);
  return d ? formatDate(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()) : formatDate(value);
}

export default function AccountsPage() {
  const { user } = useAuth();
  const [confirm, confirmDialog] = useConfirm();
  const [lists, setLists] = useState<Record<Kind, Account[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [admins, execs] = await Promise.all(
        (["admin", "executive"] as const).map(async (k) => {
          const res = await fetch(KIND[k].api, { cache: "no-store" });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || `The server answered ${res.status}.`);
          return (data?.[KIND[k].listKey] ?? []) as Account[];
        })
      );
      setLists({ admin: admins, executive: execs });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set once the request resolves
    void load();
  }, [load]);

  const retry = () => {
    setLoading(true);
    load();
  };

  const handleDelete = async (kind: Kind, account: Account) => {
    const k = KIND[kind];
    const ok = await confirm({
      title: `Delete ${k.noun} "${account.name}"?`,
      description: <p>{k.deleteNote} This cannot be undone.</p>,
      confirmLabel: `Delete ${k.noun}`,
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(k.api, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: account.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `The ${k.noun} could not be deleted.`);
      },
    });
    if (ok) {
      toast.success(`${k.noun === "admin" ? "Admin" : "Executive"} "${account.name}" deleted`);
      load();
    }
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        description="People who log in with a password. Teams, supervisors and auditors log in with a PIN instead; manage them on each event's People tab."
      />
      {confirmDialog}

      <div className="space-y-6">
        <aside className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1.5">
            <p>
              Admins and executives log in with <strong className="font-medium text-slate-900">a password only</strong>, with no
              username. The password is what identifies the person, so give everyone their own.
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-slate-600">
              <li>At least 6 characters.</li>
              <li>Each admin password must be different from every other admin&apos;s; the form refuses one that is already in use.</li>
              <li>Passwords cannot be viewed or changed later. To change one, create a new account and delete the old one.</li>
              <li>You can&apos;t delete your own account or the last admin, and there must always be at least one executive once one exists.</li>
            </ul>
          </div>
        </aside>

        {lists === null ? (
          error ? (
            <ErrorState title="Could not load accounts" message={error} onRetry={retry} retrying={loading} />
          ) : (
            <>
              <ListSkeleton rows={2} />
              <ListSkeleton rows={2} />
            </>
          )
        ) : (
          (["admin", "executive"] as const).map((kind) => (
            <AccountSection
              key={kind}
              kind={kind}
              accounts={lists[kind]}
              currentUserId={user?.type === "admin" ? user.id : undefined}
              onCreated={load}
              onDelete={(a) => handleDelete(kind, a)}
            />
          ))
        )}
      </div>
    </>
  );
}

function AccountSection({
  kind,
  accounts,
  currentUserId,
  onCreated,
  onDelete,
}: {
  kind: Kind;
  accounts: Account[];
  currentUserId?: number;
  onCreated: () => void;
  onDelete: (a: Account) => void;
}) {
  const k = KIND[kind];
  const Icon = k.icon;
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {k.title} <span className="ml-1 text-sm font-normal tabular-nums text-slate-400">{accounts.length}</span>
            </h2>
            <p className="max-w-xl text-sm text-slate-600">{k.description}</p>
          </div>
        </div>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="shrink-0">
            <Plus />
            Add {k.noun}
          </Button>
        )}
      </div>

      {accounts.length === 0 && !showForm ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          No {k.noun} accounts yet.{kind === "executive" && " Add one to give management a read-only view of progress and variances."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {accounts.map((a) => {
            const isSelf = kind === "admin" && currentUserId === a.id;
            const isLast = accounts.length <= 1;
            const blocked = isSelf ? "You can't delete your own account." : isLast ? `The last ${k.noun} can't be deleted.` : null;
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {a.name}
                    {isSelf && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">You</span>}
                  </div>
                  <div className="text-xs text-slate-500">Added {createdOn(a.createdAt)}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!blocked}
                  onClick={() => onDelete(a)}
                  title={blocked ?? `Delete ${a.name}`}
                  aria-label={`Delete ${a.name}`}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 />
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <NewAccountForm
          kind={kind}
          onDone={(created) => {
            setShowForm(false);
            if (created) onCreated();
          }}
        />
      )}
    </section>
  );
}

function NewAccountForm({ kind, onDone }: { kind: Kind; onDone: (created: boolean) => void }) {
  const k = KIND[kind];
  const [form, setForm] = useState({ name: "", password: "", confirmPassword: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = (f: string) => `${kind}-${f}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setProblem("Enter a name.");
    if (form.password.length < 6) return setProblem("The password must be at least 6 characters.");
    if (form.password !== form.confirmPassword) return setProblem("The two passwords don't match.");
    setProblem(null);
    setSaving(true);
    try {
      const res = await fetch(k.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: form.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setProblem(data.error || `The ${k.noun} could not be created.`);
        return;
      }
      toast.success(`${k.noun === "admin" ? "Admin" : "Executive"} "${name}" created`);
      onDone(true);
    } catch {
      setProblem("Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5" noValidate>
      <h3 className="text-sm font-semibold text-slate-900">New {k.noun}</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={id("name")}>Name</Label>
          <Input
            id={id("name")}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Full name"
            autoComplete="off"
            className="bg-white"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("password")}>Password</Label>
          <Input
            id={id("password")}
            type="password"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            className="bg-white"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id("confirm")}>Confirm password</Label>
          <Input
            id={id("confirm")}
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))}
            autoComplete="new-password"
            className="bg-white"
          />
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Creating…" : `Create ${k.noun}`}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
