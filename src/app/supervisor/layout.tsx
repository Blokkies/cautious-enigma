"use client";

import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  AlertTriangle,
  MessageSquare,
  Package,
  Download,
  LogOut,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/supervisor", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/supervisor/variances", icon: AlertTriangle, label: "Variances" },
  { href: "/supervisor/queries", icon: MessageSquare, label: "Queries" },
  { href: "/supervisor/breakdowns", icon: Package, label: "Breakdowns" },
  { href: "/supervisor/export", icon: Download, label: "Export" },
  { href: "/completed", icon: ClipboardCheck, label: "Summary" },
];

export default function SupervisorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-1.5 font-semibold text-primary">
            {user?.eventName && (
              <>
                <span className="text-sm font-normal text-muted-foreground">{user.eventName}</span>
                <span className="text-muted-foreground font-normal">·</span>
              </>
            )}
            <span>Supervisor: {user?.name}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-1"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      {/* Bottom nav for mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t md:hidden">
        <div className="flex items-center justify-around h-16">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 w-full h-full touch-target",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      {/* Side nav for desktop */}
      <div className="hidden md:flex">
        <aside className="w-48 fixed left-0 top-14 bottom-0 bg-white border-r p-3 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-gray-50"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </aside>
        <main className="md:ml-48 flex-1 p-4 pb-20 md:pb-4 w-full">
          {children}
        </main>
      </div>
      <main className="md:hidden p-4 pb-20">{children}</main>
    </div>
  );
}
