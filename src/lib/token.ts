import { SignJWT, jwtVerify } from "jose";

const jwtSecretValue = process.env.JWT_SECRET || "stocktake-secret-key-change-in-production-2026";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production. Set JWT_SECRET in .env.local.");
} else if (!process.env.JWT_SECRET) {
  console.warn("[SECURITY] JWT_SECRET not set — using default. Set JWT_SECRET in .env.local for production.");
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue);

const TOKEN_EXPIRY = "72h";

export interface TokenPayload {
  id: number;
  type: "team" | "supervisor" | "admin" | "auditor" | "executive";
  name: string;
  eventId: number;
  eventName: string;
  eventStatus?: string;
}

export async function createToken(payload: TokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(JWT_SECRET);
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
