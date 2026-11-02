import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}
