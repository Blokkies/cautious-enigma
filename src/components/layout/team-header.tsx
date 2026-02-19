"use client";

import { useAuth } from "@/contexts/auth-context";
import { useSettings } from "@/contexts/settings-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Button } from "@/components/ui/button";
import { LogOut, Eye, EyeOff, Smartphone, Minimize2, Maximize2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface TeamHeaderProps {
  pendingSyncs?: number;
}

export function TeamHeader({ pendingSyncs = 0 }: TeamHeaderProps) {
  const { user, logout } = useAuth();
  const { settings, toggleEasyRead, toggleHaptic, toggleCompact } = useSettings();
  const isOnline = useOnlineStatus();
  const router = useRouter();
  const cm = settings.compactMode;

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
      <div className={`flex items-center justify-between px-3 ${cm ? "h-10" : "h-14"}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {user?.eventName && (
            <>
              <span className={`${cm ? "text-xs" : "text-sm"} text-muted-foreground truncate`}>{user.eventName}</span>
              <span className="text-muted-foreground">·</span>
            </>
          )}
          <span className={`font-semibold text-primary ${cm ? "text-sm" : ""} truncate`}>{user?.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {isOnline ? (
            pendingSyncs > 0 ? (
              <span className={`${cm ? "text-[10px] px-1.5" : "text-xs px-2"} font-medium text-amber-600 bg-amber-50 py-0.5 rounded-full animate-pulse`}>
                Syncing {pendingSyncs}
              </span>
            ) : (
              <span className={`${cm ? "text-[10px] px-1.5" : "text-xs px-2"} font-medium text-green-600 bg-green-50 py-0.5 rounded-full`}>
                Online
              </span>
            )
          ) : (
            pendingSyncs > 0 ? (
              <span className={`${cm ? "text-[10px] px-1.5" : "text-xs px-2"} font-medium text-red-600 bg-red-50 py-0.5 rounded-full`}>
                Offline · {pendingSyncs}
              </span>
            ) : (
              <span className={`${cm ? "text-[10px] px-1.5" : "text-xs px-2"} font-medium text-red-600 bg-red-50 py-0.5 rounded-full`}>
                Offline
              </span>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleCompact}
            className={`${cm ? "h-7 w-7 p-0" : "touch-target"} ${settings.compactMode ? "text-blue-600 bg-blue-50 ring-2 ring-blue-200" : ""}`}
            title="Compact Mode"
          >
            {settings.compactMode ? <Minimize2 className={cm ? "h-3.5 w-3.5" : "h-4 w-4"} /> : <Maximize2 className={cm ? "h-3.5 w-3.5" : "h-4 w-4"} />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleEasyRead}
            className={`${cm ? "h-7 w-7 p-0" : "touch-target"} ${settings.easyRead ? "text-blue-600 bg-blue-50 ring-2 ring-blue-200" : ""}`}
            title="Easy Read"
          >
            {settings.easyRead ? <Eye className={cm ? "h-3.5 w-3.5" : "h-4 w-4"} /> : <EyeOff className={cm ? "h-3.5 w-3.5" : "h-4 w-4"} />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleHaptic}
            className={`${cm ? "h-7 w-7 p-0" : "touch-target"} ${settings.hapticFeedback ? "text-blue-600 bg-blue-50 ring-2 ring-blue-200" : ""}`}
            title="Haptic Feedback"
          >
            <Smartphone className={cm ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className={cm ? "h-7 w-7 p-0" : "touch-target"}>
            <LogOut className={cm ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
        </div>
      </div>
    </header>
  );
}
