"use client";

import { Suspense } from "react";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams } from "next/navigation";
import { markNotificationSeen } from "@/hooks/use-notifications";
import { filterVarianceItems, type VarianceItem, type VarianceSearchMode } from "@/components/variances/types";
import { useVariancesData } from "@/components/variances/use-variances-data";
import {
  useSerialEditing,
  useSerialVerifyAssignment,
  useVarianceEditing,
  useVarianceRowActions,
  useVarianceSelection,
} from "@/components/variances/use-variance-actions";
import { VarianceTable } from "@/components/variances/variance-table";
import { SelectionToolbar, VarianceSearchBar, VariancesHeader } from "@/components/variances/variances-toolbar";
import {
  AssignVerificationDialog,
  BulkAcceptDialog,
  EditSerialDialog,
  EditVarianceDialog,
  SerialVerifyDialog,
} from "@/components/variances/variance-dialogs";

function VariancesPageContent() {
  const { user } = useAuth();
  const isAuditor = user?.type === "auditor" || user?.type === "executive";
  const isExecutive = user?.type === "executive";
  const searchParams = useSearchParams();

  const data = useVariancesData(isExecutive);
  const { activeVariances, acceptedVariances, resolvedVariances, loading, loadVariances } = data;

  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<VarianceSearchMode>("contains");
  const [activeTab, setActiveTab] = useState("active");
  const [saving, setSaving] = useState(false);
  const [serialFilter, setSerialFilter] = useState(searchParams.get("filter") === "serials");

  // Mark serials as seen when serial filter is active
  useEffect(() => {
    if (serialFilter) {
      markNotificationSeen("supervisorSerials");
    }
  }, [serialFilter]);

  const filterItems = (items: VarianceItem[]) => filterVarianceItems(items, search, searchMode);

  const edit = useVarianceEditing(data, setSaving);
  const serialEdit = useSerialEditing(loadVariances, setSaving);
  const selection = useVarianceSelection(data, filterItems);
  const serialVerify = useSerialVerifyAssignment(loadVariances);
  const actions = useVarianceRowActions(data, setSaving);

  const applySerialFilter = (items: VarianceItem[]) => {
    if (!serialFilter) return items;
    return items.filter((v) => v.isUnknownSerial || v.isApprovedSerial);
  };

  const filteredActive = applySerialFilter(filterItems(activeVariances));
  const filteredAccepted = applySerialFilter(filterItems(acceptedVariances));
  const filteredResolved = filterItems(resolvedVariances);

  const unknownSerialCount = activeVariances.filter(
    (v) => v.isUnknownSerial
  ).length;

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  return (
    <div className="space-y-4">
      <VariancesHeader
        isExecutive={isExecutive}
        execEvents={data.execEvents}
        execEventId={data.execEventId}
        onExecEventChange={(id) => { data.setExecEventId(id); data.setLoading(true); }}
        activeVariances={activeVariances}
        activeTab={activeTab}
        stats={activeTab === "accepted" ? data.acceptedStats : data.activeStats}
      />

      <VarianceSearchBar
        search={search}
        setSearch={setSearch}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        serialFilter={serialFilter}
        setSerialFilter={setSerialFilter}
        unknownSerialCount={unknownSerialCount}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="active" className="flex-1">
            Active ({activeVariances.length})
          </TabsTrigger>
          <TabsTrigger value="accepted" className="flex-1">
            Accepted ({acceptedVariances.length})
          </TabsTrigger>
          <TabsTrigger value="resolved" className="flex-1">
            Resolved ({resolvedVariances.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {/* Selection toolbar */}
          {!isAuditor && activeVariances.length > 0 && (
            <SelectionToolbar selection={selection} activeVariances={activeVariances} filterItems={filterItems} />
          )}

          <VarianceTable
            items={filteredActive}
            emptyMessage={
              search ? "No matching variances" : serialFilter ? "No unknown serials" : "No variances recorded"
            }
            showEditButton={!isAuditor}
            showCheckbox={!isAuditor}
            showAcceptButton={!isAuditor}
            onEdit={isAuditor ? undefined : edit.openEditDialog}
            selectedCountIds={isAuditor ? undefined : selection.selectedCountIds}
            onToggleSelect={isAuditor ? undefined : selection.toggleSelection}
            canSelect={isAuditor ? undefined : selection.canSelect}
            onAccept={isAuditor ? undefined : actions.handleAccept}
            onAcceptVariance={isAuditor ? undefined : actions.handleAcceptVariance}
            onApproveUnknownSerial={isAuditor ? undefined : actions.handleApproveUnknownSerial}
            onDismissUnknownSerial={isAuditor ? undefined : actions.handleDismissUnknownSerial}
            onEditUnknownSerial={isAuditor ? undefined : serialEdit.openEditSerialDialog}
            onSerialVerify={isAuditor ? undefined : serialVerify.openSerialVerifyDialog}
            isSaving={saving}
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredActive.length} variance
            {filteredActive.length !== 1 ? "s" : ""}
          </div>
        </TabsContent>

        <TabsContent value="accepted">
          <VarianceTable
            items={filteredAccepted}
            emptyMessage={
              search
                ? "No matching accepted variances"
                : serialFilter ? "No approved serials" : "No accepted variances yet"
            }
            showEditButton={!isAuditor}
            showCheckbox={false}
            showReopenButton={!isAuditor}
            onEdit={isAuditor ? undefined : edit.openEditDialog}
            onAccept={isAuditor ? undefined : actions.handleAccept}
            onReopenVariance={isAuditor ? undefined : actions.handleReopenVariance}
            onEditUnknownSerial={isAuditor ? undefined : serialEdit.openEditSerialDialog}
            isSaving={saving}
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredAccepted.length} accepted
          </div>
        </TabsContent>

        <TabsContent value="resolved">
          <VarianceTable
            items={filteredResolved}
            emptyMessage={
              search
                ? "No matching resolved variances"
                : "No resolved variances yet"
            }
            showEditButton={false}
            showCheckbox={false}
            groupsCollapsed
            isResolvedTab
          />
          <div className="text-sm text-muted-foreground mt-2">
            {filteredResolved.length} resolved
          </div>
        </TabsContent>
      </Tabs>

      <EditVarianceDialog edit={edit} saving={saving} />
      <EditSerialDialog serialEdit={serialEdit} saving={saving} />
      <AssignVerificationDialog selection={selection} />
      <BulkAcceptDialog selection={selection} activeVariances={activeVariances} />
      <SerialVerifyDialog serialVerify={serialVerify} />
    </div>
  );
}

// useSearchParams() needs a Suspense boundary for static prerendering (Next 15+).
export default function VariancesPage() {
  return (
    <Suspense fallback={null}>
      <VariancesPageContent />
    </Suspense>
  );
}
