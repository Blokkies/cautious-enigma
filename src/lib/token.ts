import { SignJWT, jwtVerify } from "jose";

const jwtSecretValue = process.env.JWT_SECRET || "stocktake-secret-key-change-in-production-2026";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production. Set JWT_SECRET in .env.local.");
} else if (!process.env.JWT_SECRET) {
  console.warn("[SECURITY] JWT_SECRET not set — using default. Set JWT_SECRET in .env.local for production.");
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue);

/** Session lifetime. /api/auth/me renews the token once less than half remains. */
export const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 72; // 72 hours

export interface TokenPayload {
  id: number;
  type: "team" | "supervisor" | "admin" | "auditor" | "executive";
  name: string;
  eventId: number;
  eventName: string;
  eventStatus?: string;
  /** Standard JWT claims, present on verified tokens (seconds since epoch). */
  iat?: number;
  exp?: number;
}

export async function createToken(payload: TokenPayload): Promise<string> {
  // Never carry over claims from a previous token; jose sets fresh ones.
  const { iat: _iat, exp: _exp, ...claims } = payload;
  void _iat;
  void _exp;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_MAX_AGE_SECONDS)
    .sign(JWT_SECRET);
}

/** True once less than half of the token's lifetime remains. */
export function shouldRenewToken(payload: Pick<TokenPayload, "exp">, nowMs = Date.now()): boolean {
  if (typeof payload.exp !== "number") return false;
  const remaining = payload.exp - Math.floor(nowMs / 1000);
  return remaining < TOKEN_MAX_AGE_SECONDS / 2;
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}
