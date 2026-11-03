"use client";

import { Suspense } from "react";
import { ExportPageContent } from "@/components/export/export-page-content";

// useSearchParams() needs a Suspense boundary for static prerendering.
export default function ExportPage() {
  return (
    <Suspense fallback={null}>
      <ExportPageContent />
    </Suspense>
  );
}
