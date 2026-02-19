/**
 * Haptic/vibration + audio feedback utilities.
 * Each function takes a `hapticEnabled` flag since this runs outside React context.
 * Vibration works on mobile (Android Chrome). Audio works everywhere.
 */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume = 0.3) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // Resume if suspended (browser autoplay policy)
  if (ctx.state === "suspended") ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playChime(notes: { freq: number; delay: number; dur: number }[], volume = 0.3) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.delay);
    gain.gain.setValueAtTime(volume, ctx.currentTime + note.delay);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + note.delay + note.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + note.delay);
    osc.stop(ctx.currentTime + note.delay + note.dur);
  }
}

/** Count matches on-hand — pleasant double chime */
export function feedbackMatch(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([50, 30, 50]);
  playChime([
    { freq: 880, delay: 0, dur: 0.12 },
    { freq: 1175, delay: 0.1, dur: 0.15 },
  ]);
}

/** Count has variance — short low warning tone */
export function feedbackVariance(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([100]);
  playTone(440, 0.2, "triangle", 0.25);
}

/** Bin fully counted — ascending celebration chime */
export function feedbackBinComplete(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([50, 30, 50, 30, 100]);
  playChime([
    { freq: 660, delay: 0, dur: 0.12 },
    { freq: 880, delay: 0.1, dur: 0.12 },
    { freq: 1175, delay: 0.2, dur: 0.12 },
    { freq: 1320, delay: 0.3, dur: 0.25 },
  ], 0.25);
}

/** Error — low buzz tone */
export function feedbackError(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([200]);
  playTone(220, 0.3, "square", 0.15);
}

/** Serial scanned — quick tick */
export function feedbackScan(hapticEnabled: boolean) {
  if (!hapticEnabled) return;
  navigator.vibrate?.([30]);
  playTone(1000, 0.08, "sine", 0.2);
}
