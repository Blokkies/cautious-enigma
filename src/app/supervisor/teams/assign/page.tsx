"use client";

import { useAuth } from "@/contexts/auth-context";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAssignment, useAssignedBinFilters } from "@/components/teams/use-assignment";
import { AssignProgressCard, TeamAssignmentsCard, UnassignedBinsCard } from "@/components/teams/assign-cards";
import { ReassignDialog, useReassign } from "@/components/teams/reassign-dialog";

export default function SupervisorAssignPage() {
  const { user } = useAuth();
  const isAuditor = user?.type === "auditor";
  const eventId = String(user?.eventId || "");

  const assign = useAssignment(eventId);
  const reassign = useReassign(assign);
  // Assigned bin search & filters (shared across teams — only one expanded at a time)
  const filters = useAssignedBinFilters();

  if (assign.loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/supervisor/teams"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Teams
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Assign</span>
      </div>

      <h1 className="text-2xl font-bold">Assign Items to Teams</h1>

      <AssignProgressCard assign={assign} />
      <TeamAssignmentsCard assign={assign} readOnly={isAuditor} filters={filters} reassign={reassign} />
      <UnassignedBinsCard assign={assign} readOnly={isAuditor} />

      {/* Re-assign dialog */}
      <ReassignDialog assign={assign} reassign={reassign} />
    </div>
  );
}
