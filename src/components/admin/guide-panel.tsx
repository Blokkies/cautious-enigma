"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, ChevronDown, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminRoutes } from "@/lib/admin-routes";
import type { GuideContent } from "./guide-content";

/** The body of a guide: summary, numbered steps, tips, mistakes and reference lists. */
export function GuideBody({ guide, showSummary = true }: { guide: GuideContent; showSummary?: boolean }) {
  return (
    <div className="space-y-5 text-sm">
      {showSummary && <p className="text-slate-600">{guide.summary}</p>}

      {guide.steps.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold text-slate-900">What to do</h4>
          <ol className="space-y-2">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
                >
                  {i + 1}
                </span>
                <span className="text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {guide.tips.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            Tips
          </h4>
          <ul className="space-y-1.5 text-slate-600">
            {guide.tips.map((tip, i) => (
              <li key={i} className="relative pl-3.5 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-slate-300">
                {tip}
              </li>
            ))}
          </ul>
        </section>
      )}

      {guide.mistakes.length > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
            Common mistakes
          </h4>
          <ul className="space-y-1.5 text-slate-600">
            {guide.mistakes.map((m, i) => (
              <li key={i} className="relative pl-3.5 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-red-300">
                {m}
              </li>
            ))}
          </ul>
        </section>
      )}

      {guide.reference?.map((ref) => (
        <section key={ref.title} className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <h4 className="mb-1.5 text-xs font-semibold text-slate-900">{ref.title}</h4>
          <ul className="space-y-1 break-words text-xs leading-relaxed text-slate-600">
            {ref.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LearnMore({ guide }: { guide: GuideContent }) {
  return (
    <Link
      href={adminRoutes.help(guide.helpAnchor)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      Learn more in the guide
    </Link>
  );
}

export interface GuidePanelProps {
  guide: GuideContent;
  className?: string;
}

/**
 * Step guide for the setup wizard. Desktop (lg+): a card meant for a right-hand column
 * (sticky). Mobile: a collapsed "How this step works" disclosure. Render it once; it
 * switches presentation with CSS. Most pages should use <GuideLayout> instead.
 */
export function GuidePanel({ guide, className }: GuidePanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      {/* Mobile: collapsible */}
      <div className="rounded-lg border border-slate-200 bg-white lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="flex-1">How this step works</span>
          <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {open && (
          <div className="space-y-4 border-t border-slate-100 px-4 py-4">
            <GuideBody guide={guide} />
            <LearnMore guide={guide} />
          </div>
        )}
      </div>

      {/* Desktop: card */}
      <aside aria-label="Step guide" className="hidden rounded-lg border border-slate-200 bg-white lg:sticky lg:top-8 lg:block">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            How this step works
          </div>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">{guide.title}</h3>
        </div>
        <div className="max-h-[calc(100vh-12rem)] space-y-5 overflow-y-auto px-5 py-4">
          <GuideBody guide={guide} />
          <LearnMore guide={guide} />
        </div>
      </aside>
    </div>
  );
}

/**
 * Two-column step layout: content on the left, GuidePanel on the right (lg+).
 * On mobile the guide's disclosure sits above the content.
 */
export function GuideLayout({ guide, children }: { guide: GuideContent; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <GuidePanel guide={guide} className="lg:order-2" />
      <div className="min-w-0 lg:order-1">{children}</div>
    </div>
  );
}

/**
 * A full guide as a Help page section, with an anchor (`id={guide.helpAnchor}`) so wizard
 * "Learn more" links land on it.
 */
export function GuideSection({ guide, className }: { guide: GuideContent; className?: string }) {
  return (
    <section id={guide.helpAnchor} className={cn("scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5 sm:p-6", className)}>
      <h2 className="text-base font-semibold text-slate-900">{guide.title}</h2>
      <p className="mt-1 text-sm text-slate-600">{guide.summary}</p>
      <div className="mt-5">
        <GuideBody guide={guide} showSummary={false} />
      </div>
    </section>
  );
}
