"use client";

import { useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { Check, ClipboardCopy, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loginInstructions, loginSheetText, sortPeople, type LoginSheetData, type LoginSheetPerson } from "@/lib/login-sheet";
import { normalizeMembers } from "@/lib/utils";
import { useAdminEvent } from "../event-context";
import { ListSkeleton } from "../loading-state";
import { ErrorState } from "../error-state";
import { PanelSection } from "./panel-section";
import { useJson } from "./use-event-data";
import type { SupervisorInfo, TeamInfo } from "@/components/teams/types";

interface TeamsResponse {
  teams: TeamInfo[];
  supervisors: SupervisorInfo[];
}

function toSheet(eventName: string, data: TeamsResponse): LoginSheetData {
  const people = (list: SupervisorInfo[]): LoginSheetPerson[] => list.map((p) => ({ name: p.name, pin: p.pinPlain }));
  return {
    siteUrl: typeof window !== "undefined" ? window.location.origin : "",
    eventName,
    teams: data.teams.map((t) => ({ name: t.name, pin: t.pinPlain, members: normalizeMembers(t.members) })),
    supervisors: people(data.supervisors.filter((s) => s.role !== "auditor")),
    auditors: people(data.supervisors.filter((s) => s.role === "auditor")),
  };
}

function SheetTable({ title, people }: { title: string; people: LoginSheetPerson[] }) {
  if (people.length === 0) return null;
  return (
    <div className="sheet-block">
      <h4 className="mb-1.5 text-xs font-semibold text-slate-900">
        {title} <span className="font-normal text-slate-500">({people.length})</span>
      </h4>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {sortPeople(people).map((p, i) => (
            <tr key={`${p.name}-${i}`}>
              <td className="py-1.5 pr-4 align-top">
                <div className="font-medium text-slate-900">{p.name}</div>
                {p.members && p.members.length > 0 && <div className="text-xs text-slate-500">{p.members.join(", ")}</div>}
              </td>
              <td className="w-28 py-1.5 text-right align-top font-mono tabular-nums text-slate-900">
                {p.pin ?? <span className="font-sans text-xs text-slate-400">not stored</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SheetBody({ sheet }: { sheet: LoginSheetData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <div className="font-medium text-slate-900">{sheet.siteUrl}</div>
        <div>{loginInstructions(sheet)}</div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <SheetTable title="Teams" people={sheet.teams} />
        <div className="space-y-5">
          <SheetTable title="Supervisors" people={sheet.supervisors} />
          <SheetTable title="Auditors" people={sheet.auditors} />
        </div>
      </div>
    </div>
  );
}

/**
 * Printable / copyable list of names and PINs plus the site address, for handing out
 * on count day. Loads the event's people itself.
 */
export function LoginSheet({ className }: { className?: string }) {
  const { event } = useAdminEvent();
  const people = useJson<TeamsResponse>(`/api/admin/teams?eventId=${event!.id}`);
  const [printing, setPrinting] = useState(false);
  const [copied, setCopied] = useState(false);

  if (people.loading) return <ListSkeleton rows={3} />;
  if (people.error && !people.data) {
    return <ErrorState title="Could not load the login details" message={people.error} onRetry={() => void people.reload()} />;
  }
  const sheet = toSheet(event!.name, people.data ?? { teams: [], supervisors: [] });
  const empty = sheet.teams.length + sheet.supervisors.length + sheet.auditors.length === 0;

  const print = () => {
    flushSync(() => setPrinting(true));
    window.addEventListener("afterprint", () => setPrinting(false), { once: true });
    window.print();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(loginSheetText(sheet));
      setCopied(true);
      toast.success("Login sheet copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copying is blocked in this browser. Use Print instead.");
    }
  };

  return (
    <PanelSection
      className={className}
      title="Login sheet"
      description="Print it or paste it into a message so everyone knows where to go and which PIN to use."
      actions={
        !empty && (
          <>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check /> : <ClipboardCopy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" onClick={print}>
              <Printer />
              Print
            </Button>
          </>
        )
      }
    >
      {empty ? (
        <p className="text-sm text-slate-500">Add teams and supervisors first; their names and PINs appear here.</p>
      ) : (
        <SheetBody sheet={sheet} />
      )}

      {printing &&
        createPortal(
          <div id="login-sheet-print" className="p-8 text-slate-900">
            <style>{`@media print { body > *:not(#login-sheet-print) { display: none !important; } #login-sheet-print { display: block !important; } .sheet-block { break-inside: avoid; } } @media screen { #login-sheet-print { display: none; } }`}</style>
            <h1 className="mb-1 text-2xl font-semibold">{sheet.eventName}</h1>
            <p className="mb-5 text-sm text-slate-600">Login details. Keep this sheet private: anyone with a PIN can log in as that team.</p>
            <SheetBody sheet={sheet} />
          </div>,
          document.body
        )}
    </PanelSection>
  );
}
