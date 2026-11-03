import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifyToken, TOKEN_MAX_AGE_SECONDS } from "./token";

// Re-export token utilities for API routes
export { createToken, verifyToken, shouldRenewToken } from "./token";
export type { TokenPayload } from "./token";

const TOKEN_NAME = "stocktake-token";

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(
  pin: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function getTokenCookieOptions() {
  return {
    name: TOKEN_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: TOKEN_MAX_AGE_SECONDS, // 72 hours
    path: "/",
  };
}
