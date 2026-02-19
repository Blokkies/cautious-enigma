/**
 * Haptic/vibration feedback utilities.
 * Each function takes a `hapticEnabled` flag since this runs outside React context.
 */

export function feedbackMatch(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([50, 30, 50]); // double pulse
}

export function feedbackVariance(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([100]); // single long pulse
}

export function feedbackBinComplete(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([50, 30, 50, 30, 100]); // celebration pattern
}

export function feedbackError(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([200]); // long buzz
}

export function feedbackScan(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([30]); // short tap
}
