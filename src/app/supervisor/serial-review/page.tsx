"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markNotificationSeen } from "@/hooks/use-notifications";

export default function SupervisorSerialReviewPage() {
  const router = useRouter();

  useEffect(() => {
    markNotificationSeen("supervisorSerials");
    router.replace("/supervisor/variances?filter=serials");
  }, [router]);

  return (
    <div className="text-center py-12 text-muted-foreground">
      Redirecting to variances...
    </div>
  );
}
