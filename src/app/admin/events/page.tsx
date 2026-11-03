"use client";

import { PageHeader } from "@/components/admin/page-header";
import { LegacyEventsSetup } from "@/components/admin/legacy/setup-legacy";

// Events list. Interim: the previous event list + setup wizard. Phase 2 replaces it with the
// searchable/filterable events table and the "New stocktake" button (-> /admin/events/new).
export default function AdminEventsPage() {
  return (
    <>
      <PageHeader
        title="Events"
        description="Every stocktake, from setup to locked. Open one to manage its items, people, bins, results and exports."
      />
      <LegacyEventsSetup />
    </>
  );
}
