/** PINs are digits only; the login form accepts up to 6 digits (maxLength 6). */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export const PIN_RULE_MESSAGE = `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`;

/**
 * Normalize a PIN from a JSON body. Numbers are accepted and coerced to a
 * string (note: a numeric PIN loses leading zeros, so 0123 arrives as "123"
 * and is rejected as too short). Returns null when the PIN is not
 * PIN_MIN_LENGTH-PIN_MAX_LENGTH digits.
 */
export function normalizePin(value: unknown): string | null {
  let pin: string;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    pin = String(value);
  } else if (typeof value === "string") {
    pin = value.trim();
  } else {
    return null;
  }
  return /^\d+$/.test(pin) && pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH ? pin : null;
}
