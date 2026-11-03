"use client";

import { useState } from "react";
import { PeoplePanel } from "@/components/admin/panels/people-panel";
import { LoginSheet } from "@/components/admin/panels/login-sheet";

// People tab: teams, supervisors and auditors, plus the printable login sheet.
export default function EventPeoplePage() {
  // Bumped after every change so the login sheet re-reads names and PINs.
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-8">
      <PeoplePanel onChanged={() => setVersion((v) => v + 1)} />
      <LoginSheet key={version} />
    </div>
  );
}
