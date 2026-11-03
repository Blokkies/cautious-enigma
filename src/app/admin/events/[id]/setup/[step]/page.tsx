"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowRight, Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  adminRoutes,
  isSetupStep,
  SETUP_STEP_LABELS,
  SETUP_STEPS,
  type EventTab,
  type SetupStep,
} from "@/lib/admin-routes";
import { useAdminEvent } from "@/components/admin/event-context";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { GuideLayout } from "@/components/admin/guide-panel";
import { setupGuide } from "@/components/admin/guide-content";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { PageSkeleton } from "@/components/admin/loading-state";

/** Where each step's work can be done today, until the wizard steps are built (phase 2). */
const STEP_TAB: Record<SetupStep, EventTab> = {
  details: "overview",
  items: "items",
  warehouses: "items",
  people: "people",
  bins: "bins",
  review: "overview",
};

// Setup wizard step. Placeholder: stepper + guide panel are real; the step body is built in phase 2.
export default function SetupStepPage() {
  const params = useParams<{ id: string; step: string }>();
  const step = params?.step ?? "";
  const { event, loading, error, notFound: missing, reload } = useAdminEvent();

  if (!isSetupStep(step)) notFound();

  if (loading) return <PageSkeleton />;
  if (error && !event) return <ErrorState title="Could not load this event" message={error} onRetry={() => void reload()} />;
  if (missing || !event) {
    return (
      <EmptyState
        title="Event not found"
        action={
          <Button asChild>
            <Link href={adminRoutes.events}>Back to events</Link>
          </Button>
        }
      />
    );
  }

  const guide = setupGuide(step);
  const index = SETUP_STEPS.indexOf(step);

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Events", href: adminRoutes.events },
          { label: event.name, href: adminRoutes.event(event.id) },
          { label: "Setup" },
        ]}
        title={guide.title}
        description={`Step ${index + 1} of ${SETUP_STEPS.length}`}
        actions={<StatusBadge status={event.status} />}
      />

      <ol className="mb-6 flex gap-1 overflow-x-auto pb-1" aria-label="Setup steps">
        {SETUP_STEPS.map((s, i) => (
          <li key={s} className="min-w-[7rem] flex-1">
            <Link
              href={adminRoutes.setup(event.id, s)}
              aria-current={s === step ? "step" : undefined}
              className={cn(
                "block border-t-2 pt-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                s === step
                  ? "border-primary font-medium text-slate-900"
                  : i < index
                    ? "border-primary/40 text-slate-600 hover:text-slate-900"
                    : "border-slate-200 text-slate-500 hover:text-slate-900"
              )}
            >
              <span className="tabular-nums text-slate-400">{i + 1}</span> {SETUP_STEP_LABELS[s]}
            </Link>
          </li>
        ))}
      </ol>

      <GuideLayout guide={guide}>
        <EmptyState
          icon={Construction}
          title="This step is being rebuilt"
          description="The guided version of this step is on its way. You can do the same work in the event workspace now."
          action={
            <Button asChild>
              <Link href={adminRoutes.event(event.id, STEP_TAB[step])}>
                Open {STEP_TAB[step] === "overview" ? "event overview" : `the ${STEP_TAB[step]} tab`}
                <ArrowRight />
              </Link>
            </Button>
          }
        />
      </GuideLayout>
    </div>
  );
}
