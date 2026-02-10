"use client";

import { useAuth } from "@/contexts/auth-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Button } from "@/components/ui/button";
import { LogOut, Wifi, WifiOff, Cloud, CloudOff } from "lucide-react";
import { useRouter } from "next/navigation";

interface TeamHeaderProps {
  pendingSyncs?: number;
}

export function TeamHeader({ pendingSyncs = 0 }: TeamHeaderProps) {
  const { user, logout } = useAuth();
  const isOnline = useOnlineStatus();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-3">
          <div className="font-semibold text-primary">{user?.name}</div>
          <div className="flex items-center gap-1">
            {isOnline ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" />
            )}
            {pendingSyncs > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                <CloudOff className="h-3 w-3" />
                {pendingSyncs} pending
              </span>
            )}
            {pendingSyncs === 0 && isOnline && (
              <Cloud className="h-3 w-3 text-green-500" />
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="touch-target">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
