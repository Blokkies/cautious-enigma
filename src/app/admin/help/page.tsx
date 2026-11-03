import { PageHeader } from "@/components/admin/page-header";
import { GuideSection } from "@/components/admin/guide-panel";
import { HELP_SECTIONS, SETUP_GUIDES } from "@/components/admin/guide-content";
import { StatusBadge } from "@/components/admin/status-badge";
import { statusMeta } from "@/components/admin/status";
import { EVENT_STATUSES } from "@/lib/event-status";

// Help & guide. Skeleton: the lifecycle and the six setup guides are real (shared with the wizard's
// guide panels); phase 2 writes the remaining sections. Every section keeps its anchor id.
export default function AdminHelpPage() {
  const guidesByAnchor = new Map(Object.values(SETUP_GUIDES).map((g) => [g.helpAnchor, g]));

  return (
    <>
      <PageHeader
        title="Help & guide"
        description="How a stocktake runs from start to finish, and what each setup step needs."
      />

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
          <ul className="space-y-1 text-sm">
            {HELP_SECTIONS.map((s) => (
              <li key={s.anchor}>
                <a href={`#${s.anchor}`} className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {HELP_SECTIONS.map((s) => {
            const guide = guidesByAnchor.get(s.anchor);
            if (guide) return <GuideSection key={s.anchor} guide={guide} />;
            if (s.anchor === "lifecycle") {
              return (
                <section key={s.anchor} id={s.anchor} className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
                  <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Every stocktake moves through four statuses. You control each move from the event&apos;s overview.
                  </p>
                  <ol className="mt-4 space-y-3">
                    {EVENT_STATUSES.map((status) => (
                      <li key={status} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
                        <span className="w-28 shrink-0">
                          <StatusBadge status={status} showDescription={false} />
                        </span>
                        <span className="text-sm text-slate-600">{statusMeta(status).description}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            }
            return (
              <section key={s.anchor} id={s.anchor} className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
                <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
                <p className="mt-1 text-sm text-slate-500">This section is being written.</p>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
