"use client";

import Link from "next/link";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminRoutes } from "@/lib/admin-routes";
import { PageHeader } from "@/components/admin/page-header";
import { GuideLayout } from "@/components/admin/guide-panel";
import { setupGuide } from "@/components/admin/guide-content";
import { EmptyState } from "@/components/admin/empty-state";

// Setup wizard step 1 (create). Placeholder: phase 2 builds the details form, which creates
// the event and continues to /admin/events/[id]/setup/items.
export default function NewEventPage() {
  const guide = setupGuide("details");
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Events", href: adminRoutes.events }, { label: "New stocktake" }]}
        title="New stocktake"
        description="Step 1 of 6"
      />
      <GuideLayout guide={guide}>
        <EmptyState
          icon={Construction}
          title="The new setup wizard is on its way"
          description={'Until then, create a stocktake with "Create New Event" on the Events page.'}
          action={
            <Button asChild>
              <Link href={adminRoutes.events}>Go to events</Link>
            </Button>
          }
        />
      </GuideLayout>
    </>
  );
}
