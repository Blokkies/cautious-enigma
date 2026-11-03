"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, PartyPopper, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  adminRoutes,
  isSetupStep,
  SETUP_STEP_LABELS,
  SETUP_STEPS,
  type SetupStep,
} from "@/lib/admin-routes";
import {
  continueBlocker,
  isStepReachable,
  setupProgress,
  skipsWarehouses,
  stepAfter,
  stepBefore,
  type SetupProgress,
} from "@/lib/setup-progress";
import { useAdminEvent, type AdminEvent } from "@/components/admin/event-context";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { statusMeta } from "@/components/admin/status";
import { GuideLayout } from "@/components/admin/guide-panel";
import { setupGuide } from "@/components/admin/guide-content";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { PageSkeleton } from "@/components/admin/loading-state";
import { WizardFooter, WizardStepper, type WizardStepState } from "@/components/admin/setup-wizard";
import { EventDetailsForm, saveEventDetails, toFormValues } from "@/components/admin/panels/event-details-form";
import { ItemsPanel } from "@/components/admin/panels/items-panel";
import { WarehousesPanel } from "@/components/admin/panels/warehouses-panel";
import { PeoplePanel } from "@/components/admin/panels/people-panel";
import { BinsPanel } from "@/components/admin/panels/bins-panel";
import { LoginSheet } from "@/components/admin/panels/login-sheet";
import { ReadinessChecklist } from "@/components/admin/panels/readiness-checklist";
import { useLifecycleAction } from "@/components/admin/panels/lifecycle-actions";
import { InfoNote } from "@/components/admin/panels/panel-section";
import {
  readinessCounts,
  useEventReadiness,
  useItemsOverview,
} from "@/components/admin/panels/use-event-data";

function stepStates(progress: SetupProgress | null, skipWarehouses: boolean): Record<SetupStep, WizardStepState> {
  return Object.fromEntries(
    SETUP_STEPS.map((s) => {
      if (!progress) return [s, s === "details" ? "done" : "locked"];
      if (s === "warehouses" && skipWarehouses && progress.done.items) return [s, "skipped"];
      if (progress.done[s]) return [s, "done"];
      return [s, isStepReachable(s, progress) ? "open" : "locked"];
    })
  ) as Record<SetupStep, WizardStepState>;
}

const GO_LIVE_EFFECTS = [
  "Every team can log in and start counting its bins at once.",
  "Supervisors see progress and variances in real time and can send recounts.",
  "The stock file and warehouse selection are locked.",
  "Teams, PINs and bin assignments can still be changed.",
  "If something is wrong you can move the stocktake back to setup; counts already captured are kept.",
];

// Setup wizard step: URL-driven and resumable. Step state comes from the server
// (readiness counts); every step saves as it goes, so leaving is always safe.
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
        description="It may have been deleted."
        action={
          <Button asChild>
            <Link href={adminRoutes.events}>Back to events</Link>
          </Button>
        }
      />
    );
  }

  if (event.status !== "setup") return <AlreadyLive event={event} />;

  return <WizardStep key={step} event={event} step={step} />;
}

function AlreadyLive({ event }: { event: AdminEvent }) {
  const meta = statusMeta(event.status);
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Events", href: adminRoutes.events },
          { label: event.name, href: adminRoutes.event(event.id) },
          { label: "Setup" },
        ]}
        title="Setup is finished"
      />
      <EmptyState
        icon={PartyPopper}
        title={event.status === "active" ? `${event.name} is already live` : `${event.name} is ${meta.label.toLowerCase()}`}
        description={`${meta.description} Manage it from the event workspace.`}
        action={
          <Button asChild>
            <Link href={adminRoutes.event(event.id)}>
              Open the workspace
              <ArrowRight />
            </Link>
          </Button>
        }
      />
    </>
  );
}

function WizardStep({ event, step }: { event: AdminEvent; step: SetupStep }) {
  const router = useRouter();
  const { reload: reloadEvent } = useAdminEvent();
  const readiness = useEventReadiness(event);
  const overview = useItemsOverview(event.id);
  const [warehousesDirty, setWarehousesDirty] = useState(false);
  const { run, dialog } = useLifecycleAction({
    onDone: (action) => {
      if (action === "go-live") router.push(adminRoutes.event(event.id));
    },
  });

  const { reload: reloadReadiness } = readiness;
  const { reload: reloadOverview } = overview;
  const refresh = useCallback(() => {
    void reloadReadiness();
    void reloadOverview();
  }, [reloadReadiness, reloadOverview]);

  const counts = readiness.data ? readinessCounts(readiness.data) : null;
  const progress = counts ? setupProgress(counts) : null;
  const warehouseCount = overview.data?.warehouses.length ?? 0;
  const skipWarehouses = skipsWarehouses(warehouseCount);
  const states = stepStates(progress, skipWarehouses);
  const guide = setupGuide(step);
  const index = SETUP_STEPS.indexOf(step);
  const prev = stepBefore(step, skipWarehouses);
  const next = stepAfter(step, skipWarehouses);
  const exitHref = adminRoutes.event(event.id);

  const blocker = !counts
    ? readiness.error
      ? "Could not check this step. Reload the page."
      : "Checking…"
    : step === "warehouses" && warehousesDirty
      ? "Save your warehouse selection first."
      : continueBlocker(step, counts);
  const reachable = progress ? isStepReachable(step, progress) : true;

  const backButton = prev && (
    <Button variant="outline" asChild>
      <Link href={adminRoutes.setup(event.id, prev)}>
        <ArrowLeft />
        Back
      </Link>
    </Button>
  );

  const continueButton = next && (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      {blocker ? (
        <Button disabled>
          Continue to {SETUP_STEP_LABELS[next].toLowerCase()}
          <ArrowRight />
        </Button>
      ) : (
        <Button asChild>
          <Link href={adminRoutes.setup(event.id, next)}>
            Continue to {SETUP_STEP_LABELS[next].toLowerCase()}
            <ArrowRight />
          </Link>
        </Button>
      )}
      {blocker && (
        <p className="max-w-sm text-xs text-slate-500 sm:text-right" role="status">
          {blocker === "Checking…" ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          {blocker}
        </p>
      )}
    </div>
  );

  let body: React.ReactNode;
  switch (step) {
    case "details":
      body = (
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <EventDetailsForm
            initial={toFormValues(event)}
            submitLabel="Save and continue"
            onSubmit={async (values) => {
              await saveEventDetails(event.id, values);
              await reloadEvent();
              toast.success("Details saved");
              router.push(adminRoutes.setup(event.id, "items"));
            }}
          />
        </section>
      );
      break;
    case "items":
      body = <ItemsPanel onChanged={refresh} />;
      break;
    case "warehouses":
      body =
        overview.data && skipWarehouses && warehouseCount > 0 ? (
          <InfoNote>
            The stock file has a single warehouse (<strong>{overview.data.warehouses[0].warehouse}</strong>), so there is nothing to
            choose and this step is skipped. All its items are counted.
          </InfoNote>
        ) : (
          <WarehousesPanel onChanged={refresh} onDirtyChange={setWarehousesDirty} />
        );
      break;
    case "people":
      body = <PeoplePanel onChanged={refresh} />;
      break;
    case "bins":
      body = <BinsPanel onChanged={refresh} peopleHref={adminRoutes.setup(event.id, "people")} />;
      break;
    case "review":
      body = (
        <div className="space-y-6">
          <ReadinessChecklist eventId={event.id} state={readiness} linkTo="wizard" />
          <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
            <h3 className="mb-2 text-base font-semibold text-slate-900">What happens when you go live</h3>
            <ul className="space-y-1.5 text-sm text-slate-600">
              {GO_LIVE_EFFECTS.map((t) => (
                <li key={t} className="relative pl-4 before:absolute before:left-0 before:top-[0.6em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-emerald-500">
                  {t}
                </li>
              ))}
            </ul>
          </section>
          <LoginSheet />
        </div>
      );
      break;
  }

  const goLiveBlocked = !readiness.data || !!readiness.data.blocker;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Events", href: adminRoutes.events },
          { label: event.name, href: adminRoutes.event(event.id) },
          { label: "Setup" },
        ]}
        title={guide.title}
        description={`Step ${index + 1} of ${SETUP_STEPS.length}. Everything is saved as you go.`}
        actions={<StatusBadge status={event.status} />}
      />

      <WizardStepper eventId={event.id} current={step} states={states} />

      <GuideLayout guide={guide}>
        {!reachable && progress && (
          <div className="mb-4">
            <InfoNote tone="warning">
              Finish <Link href={adminRoutes.setup(event.id, progress.next)} className="font-medium underline">{SETUP_STEP_LABELS[progress.next].toLowerCase()}</Link>{" "}
              first. This step depends on it.
            </InfoNote>
          </div>
        )}
        {body}

        {step !== "details" && (
          <WizardFooter
            back={backButton}
            exitHref={exitHref}
            next={
              step === "review" ? (
                <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
                  <Button size="lg" onClick={() => void run("go-live")} disabled={goLiveBlocked}>
                    <Play />
                    Go live
                  </Button>
                  {goLiveBlocked && (
                    <p className="max-w-sm text-xs text-slate-500 sm:text-right" role="status">
                      {readiness.data?.blocker ?? "Checking readiness…"}
                    </p>
                  )}
                </div>
              ) : (
                continueButton
              )
            }
          />
        )}
        {step === "details" && <WizardFooter exitHref={exitHref} />}
      </GuideLayout>
      {dialog}
    </div>
  );
}
