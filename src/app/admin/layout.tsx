"use client";

import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Settings,
  LogOut,
  ClipboardCheck,
  UserCog,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/setup", icon: Settings, label: "Events" },
  { href: "/admin/summary", icon: ClipboardCheck, label: "Summary" },
  { href: "/admin/files", icon: FileSpreadsheet, label: "Files" },
  { href: "/admin/settings", icon: UserCog, label: "Settings" },
];

export default function AdminLayout({
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
          <div className="font-semibold text-primary">Stocktake Admin</div>
          <div className="flex items-center gap-2">
            {user && (
              <span className="text-sm text-muted-foreground">{user.name}</span>
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
        <div className="flex border-t">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive =
              href === "/admin/setup"
                ? ["/admin/setup", "/admin/import", "/admin/teams", "/admin/activate"].some(
                    (p) => pathname.startsWith(p)
                  )
                : pathname === href || pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-5 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </div>
      </header>
      <main className="p-4 max-w-4xl mx-auto">{children}</main>
    </div>
  );
}
