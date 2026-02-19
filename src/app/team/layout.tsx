"use client";

import { TeamHeader } from "@/components/layout/team-header";
import { TeamNav } from "@/components/layout/team-nav";
import { useSync } from "@/hooks/use-sync";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useSettings } from "@/contexts/settings-context";

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sync = useSync();
  useServiceWorker();
  const { settings } = useSettings();

  return (
    <div className="min-h-screen bg-gray-50" data-easy-read={settings.easyRead ? "true" : "false"}>
      <TeamHeader pendingSyncs={sync.pendingCount} />
      <main className={settings.compactMode ? "pb-14" : "pb-20"}>{children}</main>
      <TeamNav />
    </div>
  );
}
