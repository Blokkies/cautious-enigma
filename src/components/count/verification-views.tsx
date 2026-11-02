"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActiveItemCard, QueueItemRow, QueueGroupRow } from "@/components/counting/item-card";
import { SerializedGroupCard, type SerialGroupResult } from "@/components/counting/serialized-group-card";
import { ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  verificationItemToCountItem,
  type SerialVerificationResult,
  type SerialVerificationTask,
  type VerificationQueueEntry,
} from "./types";

/** Blind verification recount of the items in one bin (single items + serialized groups). */
export function VerificationCountingView({
  verificationQueue,
  verificationIndex,
  setVerificationIndex,
  selectedVerificationBin,
  remainingCount,
  onBack,
  verificationQtyValue,
  setVerificationQtyValue,
  verificationComment,
  setVerificationComment,
  onSubmitSingle,
  onSubmitSerializedGroup,
  inputRef,
  isSubmitting,
  showFlash,
  onFlashComplete,
}: {
  verificationQueue: VerificationQueueEntry[];
  verificationIndex: number;
  setVerificationIndex: Dispatch<SetStateAction<number>>;
  selectedVerificationBin: string | null;
  /** Remaining verification items in the selected bin */
  remainingCount: number;
  onBack: () => void;
  verificationQtyValue: string;
  setVerificationQtyValue: (v: string) => void;
  verificationComment: string;
  setVerificationComment: (v: string) => void;
  onSubmitSingle: () => void;
  onSubmitSerializedGroup: (results: SerialGroupResult[], unknownSerials?: string[]) => void | Promise<void>;
  inputRef: RefObject<HTMLInputElement | null>;
  isSubmitting: boolean;
  showFlash: boolean;
  onFlashComplete: () => void;
}) {
  const currentVerificationEntry = verificationQueue[verificationIndex] ?? null;

  if (!currentVerificationEntry) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">No verification items</div>
      </div>
    );
  }

  const upcomingVerificationEntries = verificationQueue.filter((_, i) => i !== verificationIndex);

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Sticky header */}
      <div className="sticky top-14 z-40 bg-purple-50 border-b border-purple-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge className="bg-purple-100 text-purple-800 border-purple-300">
            Verification
          </Badge>
          <span className="font-mono font-semibold text-sm">
            {selectedVerificationBin || "All"}
          </span>
          <span className="text-sm text-muted-foreground">
            {remainingCount} remaining
          </span>
        </div>
      </div>

      {/* Main content — extra pb for sticky action bar */}
      <div className="flex-1 overflow-y-auto p-4 pb-52 space-y-4">
        <div className="max-w-lg mx-auto">
          {currentVerificationEntry.type === "serialized-group" ? (
            <SerializedGroupCard
              key={`ver-serial-${currentVerificationEntry.itemCode}`}
              entry={{
                type: "serialized-group",
                itemCode: currentVerificationEntry.itemCode,
                description: currentVerificationEntry.description,
                brand: currentVerificationEntry.brand,
                stockStatus: currentVerificationEntry.stockStatus,
                items: currentVerificationEntry.items.map(verificationItemToCountItem),
              }}
              onSubmitAll={onSubmitSerializedGroup}
              onSkip={() => {
                if (verificationQueue.length <= 1) return;
                setVerificationIndex((i) => (i + 1) % verificationQueue.length);
              }}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={onFlashComplete}
              comment={verificationComment}
              onCommentChange={setVerificationComment}
            />
          ) : (
            <ActiveItemCard
              item={verificationItemToCountItem(currentVerificationEntry.item)}
              qtyValue={verificationQtyValue}
              onQtyChange={setVerificationQtyValue}
              onSubmit={onSubmitSingle}
              onSkip={() => {
                if (verificationQueue.length <= 1) return;
                setVerificationIndex((i) => (i + 1) % verificationQueue.length);
              }}
              comment={verificationComment}
              onCommentChange={setVerificationComment}
              inputRef={inputRef}
              isSubmitting={isSubmitting}
              showSuccessFlash={showFlash}
              onFlashComplete={onFlashComplete}
              isVerification
            />
          )}
        </div>

        {/* Remaining verification entries in this bin */}
        {upcomingVerificationEntries.length > 0 && (
          <div className="max-w-lg mx-auto">
            <div className="text-sm font-medium text-muted-foreground mb-2">
              Up Next ({upcomingVerificationEntries.length} more)
            </div>
            <Card>
              <div className="max-h-[300px] overflow-y-auto">
                <CardContent className="p-0">
                  {upcomingVerificationEntries.slice(0, 20).map((entry, i) =>
                    entry.type === "serialized-group" ? (
                      <QueueGroupRow
                        key={`ver-group-${entry.itemCode}`}
                        entry={{
                          type: "serialized-group",
                          itemCode: entry.itemCode,
                          description: entry.description,
                          brand: entry.brand,
                          stockStatus: entry.stockStatus,
                          items: entry.items.map(verificationItemToCountItem),
                        }}
                        position={i + 1}
                      />
                    ) : (
                      <QueueItemRow
                        key={entry.item.verificationId}
                        item={verificationItemToCountItem(entry.item)}
                        position={i + 1}
                      />
                    )
                  )}
                </CardContent>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/** Supervisor-requested physical check of unknown serials: mark each Present / Not Found. */
export function SerialVerificationView({
  activeSerialTask,
  serialVerificationResults,
  setSerialVerificationResults,
  serialVerificationSubmitting,
  setSerialVerificationSubmitting,
  onBack,
  onSubmitted,
}: {
  activeSerialTask: SerialVerificationTask;
  serialVerificationResults: Record<string, SerialVerificationResult>;
  setSerialVerificationResults: Dispatch<SetStateAction<Record<string, SerialVerificationResult>>>;
  serialVerificationSubmitting: boolean;
  setSerialVerificationSubmitting: Dispatch<SetStateAction<boolean>>;
  onBack: () => void;
  /** Called after the PATCH succeeds (and the success toast is shown). */
  onSubmitted: () => void;
}) {
  const allMarked = activeSerialTask.unknownSerials.every(
    (s) => serialVerificationResults[s] !== undefined
  );

  const handleSerialVerificationSubmit = async () => {
    if (!allMarked) {
      toast.error("Please mark all serials before submitting");
      return;
    }

    setSerialVerificationSubmitting(true);
    try {
      const verifiedSerials = activeSerialTask.unknownSerials.map((serial) => ({
        serial,
        status: serialVerificationResults[serial],
      }));

      const res = await fetch("/api/team/serial-discrepancies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discrepancyId: activeSerialTask.id,
          verifiedSerials,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to submit verification");
        return;
      }

      toast.success("Serial verification submitted");
      onSubmitted();
    } catch {
      toast.error("Failed — check your connection");
    } finally {
      setSerialVerificationSubmitting(false);
    }
  };

  const toggleSerialResult = (serial: string, status: SerialVerificationResult) => {
    setSerialVerificationResults((prev) => {
      if (prev[serial] === status) {
        const next = { ...prev };
        delete next[serial];
        return next;
      }
      return { ...prev, [serial]: status };
    });
  };

  const confirmedCount = activeSerialTask.unknownSerials.filter(
    (s) => serialVerificationResults[s] === "confirmed"
  ).length;
  const notFoundCount = activeSerialTask.unknownSerials.filter(
    (s) => serialVerificationResults[s] === "not_found"
  ).length;
  const unmarkedCount = activeSerialTask.unknownSerials.length - confirmedCount - notFoundCount;

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Sticky header */}
      <div className="sticky top-14 z-40 bg-amber-50 border-b border-amber-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="px-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge className="bg-amber-100 text-amber-800 border-amber-300">
            Serial Verification
          </Badge>
          <span className="font-mono font-semibold text-sm">
            {activeSerialTask.itemCode}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 pl-9 text-xs text-muted-foreground">
          {activeSerialTask.binNumber && (
            <span>Bin: <span className="font-mono font-medium">{activeSerialTask.binNumber}</span></span>
          )}
          <span>{activeSerialTask.unknownSerials.length} serial{activeSerialTask.unknownSerials.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-lg mx-auto space-y-4">
          {/* Description */}
          {activeSerialTask.description && (
            <div className="text-sm text-muted-foreground">
              {activeSerialTask.description}
            </div>
          )}

          {/* Progress summary */}
          <div className="flex items-center gap-2 text-xs">
            {confirmedCount > 0 && (
              <Badge className="bg-green-100 text-green-800 border-green-300">
                {confirmedCount} confirmed
              </Badge>
            )}
            {notFoundCount > 0 && (
              <Badge className="bg-red-100 text-red-800 border-red-300">
                {notFoundCount} not found
              </Badge>
            )}
            {unmarkedCount > 0 && (
              <Badge variant="secondary">
                {unmarkedCount} remaining
              </Badge>
            )}
          </div>

          {/* Serial list */}
          <div className="space-y-2">
            {activeSerialTask.unknownSerials.map((serial) => {
              const result = serialVerificationResults[serial];
              return (
                <Card key={serial} className={`${
                  result === "confirmed"
                    ? "border-green-300 bg-green-50/50"
                    : result === "not_found"
                      ? "border-red-300 bg-red-50/50"
                      : ""
                }`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-bold text-sm">
                          {serial}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant={result === "confirmed" ? "default" : "outline"}
                          className={`h-9 text-xs ${
                            result === "confirmed"
                              ? "bg-green-600 hover:bg-green-700 text-white"
                              : "text-green-700 border-green-300 hover:bg-green-50"
                          }`}
                          onClick={() => toggleSerialResult(serial, "confirmed")}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Present
                        </Button>
                        <Button
                          size="sm"
                          variant={result === "not_found" ? "default" : "outline"}
                          className={`h-9 text-xs ${
                            result === "not_found"
                              ? "bg-red-600 hover:bg-red-700 text-white"
                              : "text-red-700 border-red-300 hover:bg-red-50"
                          }`}
                          onClick={() => toggleSerialResult(serial, "not_found")}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                          Not Found
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Submit button */}
          <Button
            className={`w-full h-14 text-lg font-bold ${
              allMarked
                ? "bg-green-600 hover:bg-green-700 text-white"
                : ""
            }`}
            disabled={!allMarked || serialVerificationSubmitting}
            onClick={handleSerialVerificationSubmit}
          >
            {serialVerificationSubmitting
              ? "Submitting..."
              : allMarked
                ? "Submit Verification"
                : `${unmarkedCount} serial${unmarkedCount !== 1 ? "s" : ""} remaining`}
          </Button>
        </div>
      </div>
    </div>
  );
}
