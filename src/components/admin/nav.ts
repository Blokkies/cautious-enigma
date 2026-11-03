import { Archive, BookOpen, CalendarRange, FileOutput, LayoutDashboard, UserCog, type LucideIcon } from "lucide-react";
import { adminRoutes, isNavActive } from "@/lib/admin-routes";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Sidebar items, in order. */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: adminRoutes.overview, label: "Overview", icon: LayoutDashboard },
  { href: adminRoutes.events, label: "Events", icon: CalendarRange },
  { href: adminRoutes.exports, label: "Exports", icon: FileOutput },
  { href: adminRoutes.files, label: "Files", icon: Archive },
  { href: adminRoutes.accounts, label: "Accounts", icon: UserCog },
  { href: adminRoutes.help(), label: "Help & guide", icon: BookOpen },
];

/** The nav item the current path belongs to (nested routes included). */
export function activeNavItem(pathname: string): AdminNavItem | undefined {
  return ADMIN_NAV.find((item) => isNavActive(item.href, pathname));
}
