"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type { CountItem } from "@/components/counting/item-card";
import type { SerialGroupResult } from "@/components/counting/serialized-group-card";
import {
  saveCountLocally,
  markCountSynced,
  markCountsRejected,
  isDefinitiveRejection,
  isServiceWorkerOffline,
  saveDiscrepancyLocally,
  markDiscrepancySynced,
  type OfflineScope,
} from "@/stores/offline-db";
import {
  naturalCompare,
  type BinTab,
  type CountStats,
  type PageState,
  type VerificationItem,
  type VerificationQueueEntry,
} from "./types";

/**
 * Send unknown serials as a single discrepancy record to the supervisor.
 * Saved to IndexedDB first so data survives offline/browser close.
 */
export async function reportUnknownSerials(discData: {
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  binInternalId: string | null;
  unknownSerials: string[];
}): Promise<void> {
  const { unknownSerials } = discData;
  const discClientId = crypto.randomUUID();

  // Save to IndexedDB first so data survives offline/browser close
  try {
    await saveDiscrepancyLocally({
      clientId: discClientId,
      ...discData,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // IndexedDB unavailable — continue with POST
  }

  try {
    const res = await fetch("/api/team/serial-discrepancies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...discData, clientId: discClientId }),
    });
    if (!res.ok) throw new Error("Failed");
    try { await markDiscrepancySynced(discClientId); } catch { /* ok */ }
    toast.info(`${unknownSerials.length} unknown serial(s) sent to supervisor for review`);
  } catch {
    toast.info(`${unknownSerials.length} unknown serial(s) saved — will send to supervisor when online`);
  }
}

/**
 * Offline-first count submission for regular (non-verification) counts:
 * IndexedDB first, optimistic UI update, then POST /api/team/count.
 */
export function useCountSubmission({
  items,
  offlineScope,
  setItems,
  setStats,
}: {
  items: CountItem[];
  offlineScope: Partial<OfflineScope>;
  setItems: Dispatch<SetStateAction<CountItem[]>>;
  setStats: Dispatch<SetStateAction<CountStats>>;
}) {
  const handleCount = useCallback(
    /** Resolves true if the count was saved (on the server, or queued offline for sync). */
    async (itemId: number, qty: number, countComment?: string, silent?: boolean): Promise<boolean> => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return false;

      // Block changes to items reviewed by supervisor
      if (item.checkStatus === "accepted") {
        if (!silent) toast.error("This item has been reviewed by a supervisor and cannot be changed");
        return false;
      }

      // Block changes to items with pending verification
      if (item.hasPendingVerification) {
        if (!silent) toast.error("This item has a pending verification and cannot be edited");
        return false;
      }

      const clientId = uuidv4();
      const onHand = item.onHand ?? 0;
      const variance = qty - onHand;
      const isMatch = variance === 0;
      const countedAt = new Date().toISOString();

      // Save to IndexedDB FIRST so data survives network failures / browser close
      try {
        await saveCountLocally({
          clientId,
          itemId,
          countedQty: qty,
          isMatch,
          // undefined = keep the existing server comment when synced
          comment: countComment,
          countedAt,
          ...offlineScope,
        });
      } catch {
        // IndexedDB unavailable — continue with server POST anyway
      }

      // Save previous state for potential rollback
      const prevCountId = item.countId;
      const prevCountedQty = item.countedQty;
      const prevVariance = item.variance;
      const prevIsMatch = item.isMatch;
      const prevComment = item.comment;
      const prevCountedAt = item.countedAt;

      // Optimistic UI update
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                countId: i.countId || -1,
                countedQty: qty,
                variance,
                isMatch,
                comment: countComment === undefined ? i.comment : countComment || null,
                countedAt,
              }
            : i
        )
      );
      if (!item.countId) {
        setStats((prev) => ({
          ...prev,
          counted: prev.counted + 1,
          progressPercent:
            prev.total > 0
              ? Math.round(((prev.counted + 1) / prev.total) * 100)
              : 0,
        }));
      }

      // Try to sync to server immediately
      try {
        const res = await fetch("/api/team/count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            countedQty: qty,
            isMatch,
            comment: countComment,
            clientId,
            countedAt,
          }),
        });

        if (!res.ok && !isDefinitiveRejection(res.status)) {
          // Offline (service worker), session expired, or transient server error:
          // the count is queued in IndexedDB and useSync will retry — keep optimistic state.
          if (!silent) {
            if (isServiceWorkerOffline(res)) {
              toast.info("Saved offline — will sync when back online");
            } else if (res.status === 401) {
              toast.warning("Session expired — count saved on this device, log in again to sync");
            } else {
              toast.info("Server busy — count saved and will retry automatically");
            }
          }
          return true;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          // Definitive server rejection: never retry this record
          try {
            await markCountsRejected([clientId], errData.error);
          } catch {
            // IndexedDB unavailable
          }
          // Revert optimistic update on server rejection
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    countId: prevCountId,
                    countedQty: prevCountedQty,
                    variance: prevVariance,
                    isMatch: prevIsMatch,
                    comment: prevComment,
                    countedAt: prevCountedAt,
                  }
                : i
            )
          );
          if (!prevCountId) {
            setStats((prev) => ({
              ...prev,
              counted: Math.max(0, prev.counted - 1),
              progressPercent:
                prev.total > 0
                  ? Math.round((Math.max(0, prev.counted - 1) / prev.total) * 100)
                  : 0,
            }));
          }
          if (!silent) toast.error(errData.error || "Failed to save count");
          return false;
        }

        const data = await res.json();

        // Mark as synced in IndexedDB
        try {
          await markCountSynced(clientId);
        } catch {
          // IndexedDB unavailable — server has the data, acceptable
        }

        if (data.count) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId
                ? {
                    ...i,
                    countId: data.count.id,
                    countedQty: data.count.countedQty,
                    variance: data.count.variance,
                    isMatch: data.count.isMatch,
                    comment: data.count.comment,
                    countedAt: data.count.countedAt,
                  }
                : i
            )
          );
        }

        if (!isMatch && !silent) {
          toast.warning(`Variance: ${variance > 0 ? "+" : ""}${variance}`);
        }
        return true;
      } catch {
        // Network failed — count is safely in IndexedDB, useSync will retry
        if (!silent) toast.info("Saved offline — will sync when back online");
        return true;
      }
    },
    [items, offlineScope, setItems, setStats]
  );

  return { handleCount };
}

/**
 * Offline-first submission of verification counts (single items and serialized groups).
 * The clientId for a verification is reused across retries (server dedups on it) via
 * `verificationClientIdsRef`; `isSubmittingRef` is the page-wide double-submit guard.
 */
export function useVerificationSubmission({
  offlineScope,
  isSubmittingRef,
  verificationClientIdsRef,
  setIsSubmitting,
  currentVerificationItem,
  verificationQtyValue,
  verificationComment,
  verificationItems,
  scopedVerificationItems,
  verificationQueue,
  verificationIndex,
  selectedVerificationBin,
  autoNextBin,
  startVerificationCounting,
  setVerificationItems,
  setVerificationIndex,
  setShowFlash,
  setSelectedVerificationBin,
  setPageState,
  setBinTab,
}: {
  offlineScope: Partial<OfflineScope>;
  isSubmittingRef: MutableRefObject<boolean>;
  verificationClientIdsRef: MutableRefObject<Map<number, string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  currentVerificationItem: VerificationItem | null;
  verificationQtyValue: string;
  verificationComment: string;
  verificationItems: VerificationItem[];
  scopedVerificationItems: VerificationItem[];
  verificationQueue: VerificationQueueEntry[];
  verificationIndex: number;
  selectedVerificationBin: string | null;
  autoNextBin: boolean;
  startVerificationCounting: (bin: string) => void;
  setVerificationItems: Dispatch<SetStateAction<VerificationItem[]>>;
  setVerificationIndex: Dispatch<SetStateAction<number>>;
  setShowFlash: Dispatch<SetStateAction<boolean>>;
  setSelectedVerificationBin: Dispatch<SetStateAction<string | null>>;
  setPageState: Dispatch<SetStateAction<PageState>>;
  setBinTab: Dispatch<SetStateAction<BinTab>>;
}) {
  const submitVerificationCount = useCallback(async () => {
    if (!currentVerificationItem || isSubmittingRef.current) return;
    const qty = parseFloat(verificationQtyValue);
    if (isNaN(qty) || qty < 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    const verificationId = currentVerificationItem.verificationId;
    // Reuse the clientId across retries so the server dedups instead of double-inserting
    let clientId = verificationClientIdsRef.current.get(verificationId);
    if (!clientId) {
      clientId = uuidv4();
      verificationClientIdsRef.current.set(verificationId, clientId);
    }
    const isMatch = qty === (currentVerificationItem.onHand ?? 0);
    const countedAt = new Date().toISOString();

    // Save to IndexedDB first so data survives network failures
    try {
      await saveCountLocally({
        clientId,
        itemId: currentVerificationItem.itemId,
        countedQty: qty,
        isMatch,
        comment: verificationComment || null,
        countedAt,
        verificationId,
        ...offlineScope,
      });
    } catch {
      // IndexedDB unavailable — continue with server POST
    }

    try {
      let savedOffline = false;
      try {
        const res = await fetch("/api/team/count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: currentVerificationItem.itemId,
            countedQty: qty,
            isMatch,
            comment: verificationComment || undefined,
            clientId,
            countedAt,
            verificationId,
          }),
        });

        if (!res.ok && isDefinitiveRejection(res.status)) {
          const data = await res.json().catch(() => ({}));
          try { await markCountsRejected([clientId], data.error); } catch { /* ok */ }
          verificationClientIdsRef.current.delete(verificationId);
          toast.error(data.error || "Failed to submit verification");
          return;
        }

        if (res.ok) {
          // Mark as synced in IndexedDB
          try { await markCountSynced(clientId); } catch { /* ok */ }
        } else {
          // Offline / transient error — queued in IndexedDB, useSync will retry
          savedOffline = true;
        }
      } catch {
        savedOffline = true;
      }
      verificationClientIdsRef.current.delete(verificationId);

      if (savedOffline) {
        toast.info("Verification saved offline — will sync when back online");
      }

      const onHand = currentVerificationItem.onHand ?? 0;
      const variance = qty - onHand;
      if (variance !== 0) {
        toast.warning(`Variance: ${variance > 0 ? "+" : ""}${variance}`);
      }

      // Check if this was the last item in the bin before removing
      const remainingInBin = scopedVerificationItems.filter(
        (v) => v.verificationId !== currentVerificationItem.verificationId
      );

      // Remove completed item from list
      setVerificationItems((prev) =>
        prev.filter((v) => v.verificationId !== currentVerificationItem.verificationId)
      );

      if (remainingInBin.length === 0) {
        // Last item in this bin
        toast.success("All verifications in this bin complete!");
        setVerificationIndex(0);
        setShowFlash(false);

        // Check if there are still items in other bins
        const totalRemaining = verificationItems.filter(
          (v) => v.verificationId !== currentVerificationItem.verificationId
        );

        if (autoNextBin && totalRemaining.length > 0) {
          // Find next verification bin in natural sort order
          const remainingBins = Array.from(new Set(totalRemaining.map((v) => v.binNumber || "No Bin"))).sort(naturalCompare);
          const currentVBin = selectedVerificationBin || "";
          const nextVBin = remainingBins.find((b) => naturalCompare(b, currentVBin) > 0) ?? remainingBins[0];
          if (nextVBin) {
            startVerificationCounting(nextVBin);
            return;
          }
        }

        setSelectedVerificationBin(null);
        setPageState("bin-selection");
        if (totalRemaining.length > 0) {
          setBinTab("verification");
        }
        return;
      }

      // Show flash for next item
      setShowFlash(true);
    } catch {
      toast.error("Failed to submit — check your connection");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [currentVerificationItem, verificationQtyValue, verificationComment, offlineScope, scopedVerificationItems, verificationItems, autoNextBin, selectedVerificationBin, startVerificationCounting, isSubmittingRef, verificationClientIdsRef, setIsSubmitting, setVerificationItems, setVerificationIndex, setShowFlash, setSelectedVerificationBin, setPageState, setBinTab]);

  // Submit serialized verification group (uses SerializedGroupCard)
  const submitSerializedVerificationGroup = useCallback(
    async (results: SerialGroupResult[], unknownSerials?: string[]) => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);

      const currentEntry = verificationQueue[verificationIndex];
      if (!currentEntry || currentEntry.type !== "serialized-group") {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        return;
      }

      try {
        // Submit each serial's verification count with offline fallback
        const submitResults = await Promise.all(
          results.map(async ({ itemId, qty }) => {
            const vi = currentEntry.items.find((v) => v.itemId === itemId);
            if (!vi) return { status: "rejected" as const, itemId, qty };

            const onHand = vi.onHand ?? 0;
            // Reuse the clientId across retries so the server dedups
            let cid = verificationClientIdsRef.current.get(vi.verificationId);
            if (!cid) {
              cid = uuidv4();
              verificationClientIdsRef.current.set(vi.verificationId, cid);
            }
            const isMatch = qty === onHand;
            const countedAt = new Date().toISOString();

            // Save to IndexedDB first (with verificationId so offline sync
            // submits it as a verification, not a plain count)
            try {
              await saveCountLocally({
                clientId: cid,
                itemId,
                countedQty: qty,
                isMatch,
                comment: null,
                countedAt,
                verificationId: vi.verificationId,
                ...offlineScope,
              });
            } catch { /* IndexedDB unavailable */ }

            try {
              const res = await fetch("/api/team/count", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  itemId,
                  countedQty: qty,
                  isMatch,
                  clientId: cid,
                  countedAt,
                  verificationId: vi.verificationId,
                }),
              });
              if (res.ok) {
                try { await markCountSynced(cid); } catch { /* ok */ }
                verificationClientIdsRef.current.delete(vi.verificationId);
                return { status: "saved" as const, itemId, qty };
              }
              if (isDefinitiveRejection(res.status)) {
                const data = await res.json().catch(() => ({}));
                try { await markCountsRejected([cid], data.error); } catch { /* ok */ }
                verificationClientIdsRef.current.delete(vi.verificationId);
                return { status: "rejected" as const, itemId, qty };
              }
              verificationClientIdsRef.current.delete(vi.verificationId);
              return { status: "offline" as const, itemId, qty };
            } catch {
              verificationClientIdsRef.current.delete(vi.verificationId);
              return { status: "offline" as const, itemId, qty };
            }
          })
        );

        const offlineCount = submitResults.filter((r) => r.status === "offline").length;
        const rejectedCount = submitResults.filter((r) => r.status === "rejected").length;
        if (offlineCount > 0) {
          toast.info(`${offlineCount} verification(s) saved offline — will sync when back online`);
        }
        if (rejectedCount > 0) {
          toast.error(`${rejectedCount} verification(s) rejected by the server (already completed or no longer assigned)`);
        }

        // Show consolidated summary toast (only for verifications actually saved)
        const accepted = submitResults.filter((r) => r.status !== "rejected");
        const found = accepted.filter((r) => r.qty > 0).length;
        const notFound = accepted.filter((r) => r.qty === 0).length;
        if (accepted.length === 0) {
          // nothing saved — rejection toast above covers it
        } else if (notFound > 0) {
          toast.warning(`Verification: ${found} found, ${notFound} not found`);
        } else {
          toast.success(`All ${found} serials verified`);
        }

        // Send unknown serials as discrepancy
        if (unknownSerials && unknownSerials.length > 0) {
          await reportUnknownSerials({
            itemCode: currentEntry.itemCode,
            description: currentEntry.description || null,
            binNumber: selectedVerificationBin === "No Bin" ? null : selectedVerificationBin,
            binInternalId: null,
            unknownSerials,
          });
        }

        // Remove completed items from verification list
        const completedItemIds = new Set(currentEntry.items.map((v) => v.verificationId));
        setVerificationItems((prev) =>
          prev.filter((v) => !completedItemIds.has(v.verificationId))
        );

        // Check if bin is complete
        const remainingInBin = scopedVerificationItems.filter(
          (v) => !completedItemIds.has(v.verificationId)
        );

        if (remainingInBin.length === 0) {
          toast.success("All verifications in this bin complete!");
          setVerificationIndex(0);
          setShowFlash(false);

          const totalRemaining = verificationItems.filter(
            (v) => !completedItemIds.has(v.verificationId)
          );

          if (autoNextBin && totalRemaining.length > 0) {
            const remainingBins = Array.from(new Set(totalRemaining.map((v) => v.binNumber || "No Bin"))).sort(naturalCompare);
            const currentVBin = selectedVerificationBin || "";
            const nextVBin = remainingBins.find((b) => naturalCompare(b, currentVBin) > 0) ?? remainingBins[0];
            if (nextVBin) {
              startVerificationCounting(nextVBin);
            } else {
              setSelectedVerificationBin(null);
              setPageState("bin-selection");
              setBinTab("verification");
            }
          } else {
            setSelectedVerificationBin(null);
            setPageState("bin-selection");
            if (totalRemaining.length > 0) {
              setBinTab("verification");
            }
          }
        } else {
          setShowFlash(true);
        }
      } catch {
        toast.error("Failed to submit — check your connection");
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [offlineScope, verificationQueue, verificationIndex, selectedVerificationBin, scopedVerificationItems, verificationItems, autoNextBin, startVerificationCounting, isSubmittingRef, verificationClientIdsRef, setIsSubmitting, setVerificationItems, setVerificationIndex, setShowFlash, setSelectedVerificationBin, setPageState, setBinTab]
  );

  return { submitVerificationCount, submitSerializedVerificationGroup };
}
