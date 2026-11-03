import { PageHeader } from "@/components/admin/page-header";
import { GuideBody } from "@/components/admin/guide-panel";
import { HELP_SECTIONS, SETUP_GUIDES, type GuideContent } from "@/components/admin/guide-content";
import { StatusBadge } from "@/components/admin/status-badge";
import { statusMeta } from "@/components/admin/status";
import {
  BinsExtra,
  ClosingExporting,
  CountDay,
  Faq,
  GoingLiveExtra,
  H3,
  ImportFileExtra,
  LifecycleExtra,
  P,
  PeopleExtra,
  Reviewing,
} from "@/components/admin/help-content";
import { EVENT_STATUSES } from "@/lib/event-status";

// Help & guide. Section anchors come from HELP_SECTIONS; the setup wizard's "Learn more" links
// land on them, so never rename an anchor. Setup sections reuse the wizard guides
// (guide-content.ts) and add Help-only detail from help-content.tsx.

/** Extra Help-only material shown after a setup guide, by anchor. */
const GUIDE_EXTRAS: Record<string, React.ReactNode> = {
  "import-file": <ImportFileExtra />,
  "people-and-roles": <PeopleExtra />,
  "assigning-bins": <BinsExtra />,
  "going-live": <GoingLiveExtra />,
};

const PLAIN_SECTIONS: Record<string, { intro?: string; body: React.ReactNode }> = {
  lifecycle: {
    intro: "Every stocktake moves through the same phases and four statuses. You control each move from the event's Overview tab.",
    body: (
      <>
        <H3>The four statuses</H3>
        <ol className="space-y-3">
          {EVENT_STATUSES.map((status) => (
            <li key={status} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
              <span className="w-28 shrink-0">
                <StatusBadge status={status} showDescription={false} />
              </span>
              <span className="text-sm text-slate-600">{statusMeta(status).description}</span>
            </li>
          ))}
        </ol>
        <LifecycleExtra />
      </>
    ),
  },
  "count-day": { body: <CountDay /> },
  reviewing: { body: <Reviewing /> },
  "closing-exporting": {
    intro: "Close the count, check the results, send the adjustments to NetSuite and archive the stocktake.",
    body: <ClosingExporting />,
  },
  faq: {
    intro: "The problems people run into most, with the exact message they will see and how to fix it.",
    body: <Faq />,
  },
};

function SectionShell({ anchor, title, intro, children }: { anchor: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={anchor} aria-labelledby={`${anchor}-title`} className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5 sm:p-6 lg:scroll-mt-8">
      <h2 id={`${anchor}-title`} className="text-base font-semibold text-slate-900">
        <a href={`#${anchor}`} className="hover:text-primary">
          {title}
        </a>
      </h2>
      {intro && <P className="mt-1">{intro}</P>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function AdminHelpPage() {
  const guidesByAnchor = new Map<string, GuideContent>(Object.values(SETUP_GUIDES).map((g) => [g.helpAnchor, g]));

  return (
    <>
      <PageHeader
        title="Help & guide"
        description="How a stocktake runs from start to finish: setting it up, count day, reviewing variances and exporting to NetSuite."
      />

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="mb-2 px-2 text-xs font-medium text-slate-500">On this page</h2>
          <ol className="grid gap-0.5 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {HELP_SECTIONS.map((s, i) => (
              <li key={s.anchor}>
                <a
                  href={`#${s.anchor}`}
                  className="flex gap-2 rounded px-2 py-1 text-slate-600 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-4 shrink-0 text-right text-xs tabular-nums leading-5 text-slate-400">{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          {HELP_SECTIONS.map((s) => {
            const guide = guidesByAnchor.get(s.anchor);
            if (guide) {
              const extra = GUIDE_EXTRAS[s.anchor];
              return (
                <SectionShell key={s.anchor} anchor={s.anchor} title={s.title} intro={guide.summary}>
                  <GuideBody guide={guide} showSummary={false} />
                  {extra && <div className="mt-6 border-t border-slate-100 pt-5">{extra}</div>}
                </SectionShell>
              );
            }
            const plain = PLAIN_SECTIONS[s.anchor];
            return (
              <SectionShell key={s.anchor} anchor={s.anchor} title={s.title} intro={plain?.intro}>
                {plain?.body ?? <P>See the other sections of this guide.</P>}
              </SectionShell>
            );
          })}
        </div>
      </div>
    </>
  );
}
