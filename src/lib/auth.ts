import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifyToken } from "./token";

// Re-export token utilities for API routes
export { createToken, verifyToken } from "./token";
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
    secure: false, // local network, no HTTPS
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 72, // 72 hours
    path: "/",
  };
}
