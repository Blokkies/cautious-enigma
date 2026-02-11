"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, HelpCircle, Package } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/team/count", icon: ClipboardCheck, label: "Count" },
  { href: "/team/queries", icon: HelpCircle, label: "Queries" },
  { href: "/team/breakdowns", icon: Package, label: "Breakdowns" },
];

export function TeamNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full h-full touch-target transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
