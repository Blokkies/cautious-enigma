"use client";

import { useState } from "react";
import { ItemsPanel } from "@/components/admin/panels/items-panel";
import { WarehousesPanel } from "@/components/admin/panels/warehouses-panel";

// Items tab: the stock file (import / replace / copy, mapping report, totals, download) and
// the warehouse selection. Both are read-only once the event leaves setup.
export default function EventItemsPage() {
  // Bumped after every import so the warehouse list re-reads.
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-8">
      <ItemsPanel onChanged={() => setVersion((v) => v + 1)} />
      <WarehousesPanel key={version} hideWhenEmpty />
    </div>
  );
}
