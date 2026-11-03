import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Team members are stored as a JSON array of names. Accepts an array, a JSON
 * string, or a plain comma-separated string and always returns string[].
 */
export function normalizeMembers(raw: unknown): string[] {
  let value = raw
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    try { value = JSON.parse(trimmed) } catch { value = trimmed.split(",") }
  }
  if (typeof value === "string") value = value.split(",")
  if (!Array.isArray(value)) return []
  return value.map((m) => String(m ?? "").trim()).filter(Boolean)
}

export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}
