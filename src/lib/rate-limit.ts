/**
 * Simple in-memory rate limiter for login endpoints.
 * Tracks attempts per key (IP or identifier) within a sliding window.
 */

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (now > entry.resetAt) store.delete(key);
  });
}, 60_000);

/**
 * Check if a request should be rate-limited.
 * @param key - Unique key (e.g., IP address or "login:ip")
 * @param maxAttempts - Max attempts allowed in the window (default: 10)
 * @param windowMs - Window duration in ms (default: 60 seconds)
 * @returns Object with `limited` boolean and `retryAfterMs` if limited
 */
export function checkRateLimit(
  key: string,
  maxAttempts = 10,
  windowMs = 60_000
): { limited: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { attempts: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterMs: 0 };
  }

  entry.attempts++;

  if (entry.attempts > maxAttempts) {
    return { limited: true, retryAfterMs: entry.resetAt - now };
  }

  return { limited: false, retryAfterMs: 0 };
}
