"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface AppSettings {
  easyRead: boolean;
  hapticFeedback: boolean;
  binViewMode: "grid" | "list";
}

const defaultSettings: AppSettings = {
  easyRead: false,
  hapticFeedback: false,
  binViewMode: "grid",
};

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  toggleEasyRead: () => void;
  toggleHaptic: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const STORAGE_KEY = "stocktake-settings";

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({ ...defaultSettings, ...parsed });
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  // Persist to localStorage on change (skip initial load)
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings, loaded]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const toggleEasyRead = useCallback(() => {
    setSettings((prev) => ({ ...prev, easyRead: !prev.easyRead }));
  }, []);

  const toggleHaptic = useCallback(() => {
    setSettings((prev) => ({ ...prev, hapticFeedback: !prev.hapticFeedback }));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, toggleEasyRead, toggleHaptic }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
