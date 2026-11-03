import { EventWorkspaceFrame } from "@/components/admin/event-workspace";

// Workspace header (name, location, dates, status) + tab bar for every tab under /admin/events/[id].
// The setup wizard (setup/[step]) sits outside this group and has its own chrome.
export default function EventWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <EventWorkspaceFrame>{children}</EventWorkspaceFrame>;
}
