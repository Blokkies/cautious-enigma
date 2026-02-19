"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, HelpCircle, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeamNotifications } from "@/hooks/use-notifications";
import { useSettings } from "@/contexts/settings-context";

const navItems = [
  { href: "/team/count", icon: ClipboardCheck, label: "Count", badgeKey: "verifications" as const },
  { href: "/team/queries", icon: HelpCircle, label: "Queries", badgeKey: "queries" as const },
  { href: "/team/breakdowns", icon: Package, label: "Breakdowns", badgeKey: "breakdowns" as const },
];

export function TeamNav() {
  const pathname = usePathname();
  const { counts } = useTeamNotifications();
  const { settings } = useSettings();
  const cm = settings.compactMode;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t safe-area-bottom">
      <div className={`flex items-center justify-around ${cm ? "h-11" : "h-16"}`}>
        {navItems.map(({ href, icon: Icon, label, badgeKey }) => {
          const isActive = pathname === href;
          const count = counts[badgeKey] ?? 0;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full touch-target transition-colors",
                cm ? "gap-0" : "gap-1",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="relative">
                <Icon className={cm ? "h-4 w-4" : "h-5 w-5"} />
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </span>
              <span className={`${cm ? "text-[9px]" : "text-xs"} font-medium`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
