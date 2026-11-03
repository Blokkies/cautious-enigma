/**
 * Client-side PIN rules for teams, supervisors and auditors. Uses the same limits as
 * the server (src/lib/pin.ts): digits only, PIN_MIN_LENGTH-PIN_MAX_LENGTH digits.
 */
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/pin";

export { PIN_MAX_LENGTH, PIN_MIN_LENGTH };

/** Strip everything but digits and cap the length (for input onChange handlers). */
export function sanitizePinInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH);
}

/** Error message for an invalid PIN, or null when it is acceptable. */
export function pinError(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must contain digits only";
  if (pin.length < PIN_MIN_LENGTH) return `PIN must be at least ${PIN_MIN_LENGTH} digits`;
  if (pin.length > PIN_MAX_LENGTH) return `PIN must be at most ${PIN_MAX_LENGTH} digits`;
  return null;
}
