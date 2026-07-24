/**
 * Audio cues for the WOD player, synthesized with the Web Audio API —
 * no audio assets, works fully offline. The context must be created /
 * resumed from a user gesture (the Start button).
 */

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(
  freq: number,
  startIn: number,
  dur: number,
  volume = 0.3,
  type: OscillatorType = "square",
): void {
  if (ctx?.state !== "running") return;
  const t = ctx.currentTime + startIn;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Short tick for the 3-2-1 countdown. */
export function cueTick(): void {
  tone(880, 0, 0.1);
}

/** Work phase begins — two rising high beeps. */
export function cueWork(): void {
  tone(1175, 0, 0.15);
  tone(1568, 0.18, 0.32);
}

/** Rest phase begins — single low beep. */
export function cueRest(): void {
  tone(523, 0, 0.4);
}

/** Whole WOD complete — rising triad. */
export function cueFinish(): void {
  tone(784, 0, 0.15);
  tone(988, 0.18, 0.15);
  tone(1319, 0.36, 0.6);
}
