"use client";

import { useAuth } from "@/contexts/auth-context";
import { useSettings } from "@/contexts/settings-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Button } from "@/components/ui/button";
import { LogOut, Eye, EyeOff, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";

interface TeamHeaderProps {
  pendingSyncs?: number;
}

export function TeamHeader({ pendingSyncs = 0 }: TeamHeaderProps) {
  const { user, logout } = useAuth();
  const { settings, toggleEasyRead, toggleHaptic } = useSettings();
  const isOnline = useOnlineStatus();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-1.5">
          {user?.eventName && (
            <>
              <span className="text-sm text-muted-foreground">{user.eventName}</span>
              <span className="text-muted-foreground">·</span>
            </>
          )}
          <span className="font-semibold text-primary">{user?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {isOnline ? (
            pendingSyncs > 0 ? (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full animate-pulse">
                Syncing {pendingSyncs}
              </span>
            ) : (
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                Online
              </span>
            )
          ) : (
            pendingSyncs > 0 ? (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                Offline · {pendingSyncs} pending
              </span>
            ) : (
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                Offline
              </span>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleEasyRead}
            className={`touch-target ${settings.easyRead ? "text-blue-600 bg-blue-50 ring-2 ring-blue-200" : ""}`}
            title="Easy Read"
          >
            {settings.easyRead ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleHaptic}
            className={`touch-target ${settings.hapticFeedback ? "text-blue-600 bg-blue-50 ring-2 ring-blue-200" : ""}`}
            title="Haptic Feedback"
          >
            <Smartphone className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="touch-target">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
