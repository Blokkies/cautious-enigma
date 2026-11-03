"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getPendingSyncCount, syncToServer, clearSessionOfflineData } from "@/stores/offline-db";

interface User {
  id: number;
  type: "team" | "supervisor" | "admin" | "auditor" | "executive";
  name: string;
  eventId?: number;
  eventName?: string;
  eventStatus?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (type: string, id: number, pin: string, eventId?: number) => Promise<{ success: boolean; error?: string }>;
  adminLogin: (password: string) => Promise<{ success: boolean; error?: string }>;
  executiveLogin: (password: string) => Promise<{ success: boolean; error?: string }>;
  /** Resolves false if the user cancelled logout to keep unsynced counts syncing. */
  logout: () => Promise<boolean>;
}

const LAST_USER_KEY = "stocktake:lastUser";

function rememberUser(u: User | null) {
  try {
    if (u) localStorage.setItem(LAST_USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // storage unavailable
  }
}

function recallUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        rememberUser(data.user);
        setUser(data.user);
      } else if (res.status === 401 || res.status === 403) {
        rememberUser(null);
        setUser(null);
      } else {
        // Server/SW unreachable (e.g. offline 503): reuse the last known session
        // so a team can keep counting offline after a reload.
        setUser(recallUser());
      }
    } catch {
      setUser(recallUser());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Background refresh while signed in: picks up the live event status and
  // lets /api/auth/me renew the session cookie before it expires. Only an
  // explicit 401 signs the user out; network errors (offline counting) are
  // ignored so a team is never dropped mid-count.
  const signedIn = user !== null;
  useEffect(() => {
    if (!signedIn) return;
    const refresh = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          // Keep the same object when nothing changed so effects keyed on
          // `user` don't re-run on every refresh.
          setUser((prev) => (JSON.stringify(prev) === JSON.stringify(data.user) ? prev : data.user));
        } else if (res.status === 401) {
          rememberUser(null);
          setUser(null);
        }
      } catch {
        // offline — keep the current session
      }
    };
    const interval = setInterval(refresh, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn]);

  const login = async (type: string, id: number, pin: string, eventId?: number) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, pin, eventId }),
      });
      const data = await res.json();
      if (data.success) {
        rememberUser(data.user);
        setUser(data.user);
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "Network error" };
    }
  };

  const adminLogin = async (password: string) => {
    try {
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        rememberUser(data.user);
        setUser(data.user);
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "Network error" };
    }
  };

  const executiveLogin = async (password: string) => {
    try {
      const res = await fetch("/api/auth/executive-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        rememberUser(data.user);
        setUser(data.user);
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "Network error" };
    }
  };

  const logout = async (): Promise<boolean> => {
    // Team sessions: never silently drop offline counts. Try to sync first;
    // if anything is still pending, ask before logging out. Unsynced records
    // stay on the device scoped to this team/event and sync on next login.
    if (user?.type === "team" && user.eventId != null) {
      const scope = { eventId: user.eventId, teamId: user.id };
      try {
        let pending = await getPendingSyncCount(scope);
        if (pending > 0) {
          await syncToServer(scope).catch(() => undefined);
          pending = await getPendingSyncCount(scope);
        }
        if (pending > 0) {
          const proceed = window.confirm(
            `${pending} count(s) have not synced to the server yet. They will stay on this device and sync the next time this team logs in.\n\nLog out anyway?`
          );
          if (!proceed) return false;
        } else {
          await clearSessionOfflineData(scope);
        }
      } catch {
        // IndexedDB unavailable — nothing stored locally to protect
      }
    }

    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    rememberUser(null);
    setUser(null);
    return true;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, adminLogin, executiveLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
