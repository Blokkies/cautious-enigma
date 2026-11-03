"use client";

import { Suspense } from "react";
import Link from "next/link";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminRoutes } from "@/lib/admin-routes";
import { useAdminEvent } from "@/components/admin/event-context";
import { ExportPageContent } from "@/components/export/export-page-content";
import { LoadingState } from "@/components/admin/loading-state";
import { EmptyState } from "@/components/admin/empty-state";

// Exports tab: the shared export screen (NetSuite files and full report ZIP), pinned to this event.
export default function EventExportsPage() {
  const { event } = useAdminEvent();
  if (event!.status === "setup") {
    return (
      <EmptyState
        icon={FileDown}
        title="Nothing to export yet"
        description="Export files are built from the counts. They become available once the stocktake is live. You can already download the imported items from the Items tab."
        action={
          <Button asChild variant="outline">
            <Link href={adminRoutes.event(event!.id, "items")}>Go to items</Link>
          </Button>
        }
      />
    );
  }
  return (
    <Suspense fallback={<LoadingState />}>
      <ExportPageContent key={event!.id} eventId={event!.id} />
    </Suspense>
  );
}
