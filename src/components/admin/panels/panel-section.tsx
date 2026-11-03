import { Info, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** A titled white box used by every panel. */
export function PanelSection({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description && <p className="max-w-2xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Explains why a panel can't be changed (e.g. the event is live). */
export function ReadOnlyNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** A quiet informational note. */
export function InfoNote({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm",
        tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-100 bg-blue-50/60 text-slate-700"
      )}
    >
      <Info className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warning" ? "text-amber-600" : "text-primary")} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
