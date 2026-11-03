"use client";

import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { LogOut, Download, ArrowLeft } from "lucide-react";
import { adminRoutes } from "@/lib/admin-routes";
import { parseId } from "@/lib/ids";

export default function CompletedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (user?.type === "admin") router.push(adminRoutes.overview);
                else if (user?.type === "supervisor") router.push("/supervisor");
                else router.back();
              }}
              className="gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-primary">
              Stocktake Summary
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(user?.type === "supervisor" || user?.type === "admin") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (user?.type !== "admin") {
                    router.push("/supervisor/export");
                    return;
                  }
                  // Carry the summary's selected event over to that event's exports
                  const eventId = parseId(new URLSearchParams(window.location.search).get("eventId"));
                  router.push(eventId ? adminRoutes.event(eventId, "exports") : adminRoutes.exports);
                }}
                className="gap-1"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-1"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="p-4 max-w-5xl mx-auto">{children}</main>
    </div>
  );
}
