/**
 * Best-effort client IP for rate limiting.
 *
 * Production runs behind Coolify's Traefik, which sets X-Real-Ip to the peer
 * address and APPENDS the peer address to X-Forwarded-For. Anything to the
 * left of the last X-Forwarded-For entry was sent by the client and can be
 * forged, so only the proxy-set values are trusted:
 *   1. X-Real-Ip
 *   2. the rightmost X-Forwarded-For entry
 *   3. "unknown"
 */
export function getClientIp(request: { headers: Headers }): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const entries = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  return "unknown";
}
