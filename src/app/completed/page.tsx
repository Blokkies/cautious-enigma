"use client";

import { Suspense } from "react";
import { CompletedDashboardContent } from "@/components/completed/completed-dashboard";

// useSearchParams() needs a Suspense boundary for static prerendering (Next 15+).
export default function CompletedDashboard() {
  return (
    <Suspense fallback={null}>
      <CompletedDashboardContent />
    </Suspense>
  );
}
