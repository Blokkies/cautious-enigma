import { notFound } from "next/navigation";
import { parseId } from "@/lib/ids";
import { AdminEventProvider } from "@/components/admin/event-context";

// Provides useAdminEvent() to the workspace tabs ((workspace)/...) and the setup wizard (setup/[step]).
export default async function AdminEventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = parseId(id);
  if (!eventId) notFound();
  return (
    <AdminEventProvider key={eventId} eventId={eventId}>
      {children}
    </AdminEventProvider>
  );
}
