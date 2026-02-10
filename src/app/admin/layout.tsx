"use client";

import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Settings,
  Upload,
  Users,
  Map,
  Play,
  LogOut,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/setup", icon: Settings, label: "Setup" },
  { href: "/admin/import", icon: Upload, label: "Import" },
  { href: "/admin/teams", icon: Users, label: "Teams" },
  { href: "/admin/teams/assign", icon: Map, label: "Assign" },
  { href: "/admin/activate", icon: Play, label: "Activate" },
  { href: "/completed", icon: ClipboardCheck, label: "Summary" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { logout } = useAuth();
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
          <div className="font-semibold text-primary">Admin Setup</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-1"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        {/* Step navigation */}
        <div className="flex border-t overflow-x-auto">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors",
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
