"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminRoutes, SETUP_STEPS, type SetupStep } from "@/lib/admin-routes";
import { PageHeader } from "@/components/admin/page-header";
import { GuideLayout } from "@/components/admin/guide-panel";
import { setupGuide } from "@/components/admin/guide-content";
import { WizardStepper, type WizardStepState } from "@/components/admin/setup-wizard";
import { EventDetailsForm, toFormValues } from "@/components/admin/panels/event-details-form";

const LOCKED = Object.fromEntries(SETUP_STEPS.map((s) => [s, "locked"])) as Record<SetupStep, WizardStepState>;

// Setup wizard step 1: create the stocktake, then continue at /admin/events/[id]/setup/items.
export default function NewEventPage() {
  const router = useRouter();
  const guide = setupGuide("details");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Events", href: adminRoutes.events }, { label: "New stocktake" }]}
        title="New stocktake"
        description="Six short steps take you from nothing to a live count. You can leave at any point and pick up where you left off."
      />
      <WizardStepper eventId={null} current="details" states={LOCKED} />
      <GuideLayout guide={guide}>
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-base font-semibold text-slate-900">{guide.title}</h2>
          <p className="mb-5 text-sm text-slate-600">
            The stocktake starts in setup. Nobody can count until you go live on the last step.
          </p>
          <EventDetailsForm
            initial={toFormValues(null)}
            submitLabel="Create and continue"
            autoFocus
            secondary={
              <Button variant="ghost" asChild>
                <Link href={adminRoutes.events}>Cancel</Link>
              </Button>
            }
            onSubmit={async (values) => {
              let res: Response;
              try {
                res = await fetch("/api/admin/events", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: values.name,
                    location: values.location,
                    startDate: values.startDate || null,
                    endDate: values.endDate || null,
                  }),
                });
              } catch {
                throw new Error("Could not reach the server. The stocktake was not created.");
              }
              const data = await res.json().catch(() => ({}));
              if (!res.ok || !data.id) throw new Error(data.error || `Could not create the stocktake (HTTP ${res.status}).`);
              toast.success(`${values.name} created`);
              router.replace(adminRoutes.setup(data.id, "items"));
            }}
          />
        </section>
      </GuideLayout>
    </>
  );
}
