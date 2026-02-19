"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useOnlineStatus } from "./use-online-status";
import {
  syncToServer,
  getPendingSyncCount,
  preloadItems,
} from "@/stores/offline-db";

interface SyncState {
  pendingCount: number;
  syncing: boolean;
  lastSyncTime: string | null;
  preloaded: boolean;
  authExpired: boolean;
}

export function useSync() {
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<SyncState>({
    pendingCount: 0,
    syncing: false,
    lastSyncTime: null,
    preloaded: false,
    authExpired: false,
  });
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCountRef = useRef(0);
  const authExpiredRef = useRef(false);

  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getPendingSyncCount();
      pendingCountRef.current = count;
      setState((prev) => ({ ...prev, pendingCount: count }));
    } catch {
      // IndexedDB not available
    }
  }, []);

  const doSync = useCallback(async () => {
    if (!isOnline || authExpiredRef.current) return;

    setState((prev) => ({ ...prev, syncing: true }));
    try {
      const result = await syncToServer();
      if (result.authExpired) {
        authExpiredRef.current = true;
        setState((prev) => ({ ...prev, authExpired: true, syncing: false }));
        return;
      }
      if (result.synced > 0) {
        setState((prev) => ({
          ...prev,
          lastSyncTime: new Date().toISOString(),
        }));
      }
    } catch {
      // sync failed, will retry
    } finally {
      setState((prev) => ({ ...prev, syncing: false }));
      await updatePendingCount();
    }
  }, [isOnline, updatePendingCount]);

  // Preload items on mount
  useEffect(() => {
    if (isOnline && !state.preloaded) {
      preloadItems().then((count) => {
        if (count > 0) {
          setState((prev) => ({ ...prev, preloaded: true }));
        }
      });
    }
  }, [isOnline, state.preloaded]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline) {
      doSync();
    }
  }, [isOnline, doSync]);

  // Periodic sync every 15 seconds when online
  useEffect(() => {
    if (isOnline) {
      syncIntervalRef.current = setInterval(doSync, 15000);
    }
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [isOnline, doSync]);

  // Update pending count periodically
  useEffect(() => {
    updatePendingCount();
    const interval = setInterval(updatePendingCount, 5000);
    return () => clearInterval(interval);
  }, [updatePendingCount]);

  // Warn user before closing tab if there are unsynced counts
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingCountRef.current > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return {
    ...state,
    isOnline,
    triggerSync: doSync,
  };
}
