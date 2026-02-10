"use client";

import { TeamHeader } from "@/components/layout/team-header";
import { TeamNav } from "@/components/layout/team-nav";
import { useSync } from "@/hooks/use-sync";
import { useServiceWorker } from "@/hooks/use-service-worker";

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sync = useSync();
  useServiceWorker();

  return (
    <div className="min-h-screen bg-gray-50">
      <TeamHeader pendingSyncs={sync.pendingCount} />
      <main className="pb-20">{children}</main>
      <TeamNav />
    </div>
  );
}
