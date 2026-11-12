import { describe, expect, test } from "bun:test";
import { analyzeBeats, loopRegion, MAX_JITTER_MS } from "../src/lib/beatgrid";

/**
 * A synthetic dance track: a 55 Hz kick with a click on every beat (twice as loud on
 * the one), noise hats on the off-beats, and a quiet pad so silence never
 * reads as an onset. Tempo and first downbeat are known exactly.
 */
function track(bpm: number, downbeat: number, seconds: number, sr = 22050): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  const beat = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = 0.02 * Math.sin((2 * Math.PI * 220 * i) / sr);
  for (let k = -4; downbeat + k * beat < seconds; k++) {
    const t0 = downbeat + k * beat;
    const accent = ((k % 4) + 4) % 4 === 0 ? 1 : 0.5;
    for (let j = 0; j < 0.15 * sr; j++) {
      const i = Math.round(t0 * sr) + j;
      if (i < 0 || i >= out.length) continue;
      out[i] = (out[i] ?? 0) + accent * Math.exp(-j / (0.04 * sr)) * Math.sin((2 * Math.PI * 55 * j) / sr);
      // The beater's click: a few ms of broadband noise on the attack.
      if (j < 0.004 * sr) out[i] = (out[i] ?? 0) + 0.3 * accent * noise();
    }
    const h0 = Math.round((t0 + beat / 2) * sr);
    for (let j = 0; j < 0.03 * sr; j++) {
      const i = h0 + j;
      if (i < 0 || i >= out.length) continue;
      out[i] = (out[i] ?? 0) + 0.15 * Math.exp(-j / (0.008 * sr)) * noise();
    }
  }
  return out;
}

/** A busier mix: the plain track plus an off-beat bass, a snare on 2 and 4, 16th hats and a noise floor. */
function busy(bpm: number, downbeat: number, seconds: number, sr = 22050): Float32Array {
  const out = track(bpm, downbeat, seconds, sr);
  const beat = 60 / bpm;
  let seed = 5;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const hit = (t0: number, len: number, f: (j: number) => number) => {
    const s0 = Math.round(t0 * sr);
    for (let j = 0; j < len * sr; j++) {
      const i = s0 + j;
      if (i >= 0 && i < out.length) out[i] = (out[i] ?? 0) + f(j);
    }
  };
  for (let k = 0; downbeat + k * beat < seconds; k++) {
    const t0 = downbeat + k * beat;
    hit(t0 + beat / 2, beat / 2, (j) => 0.35 * Math.sin((2 * Math.PI * 82 * j) / sr) * Math.exp(-j / (0.1 * sr)));
    if (k % 2 === 1) hit(t0, 0.12, (j) => 0.4 * noise() * Math.exp(-j / (0.03 * sr)));
    for (let q = 0; q < 4; q++) hit(t0 + (q * beat) / 4, 0.02, (j) => 0.08 * noise() * Math.exp(-j / (0.005 * sr)));
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + 0.03 * noise();
  return out;
}

describe("beat grid", () => {
  test("finds the real tempo and first downbeat, off the requested tempo", () => {
    const g = analyzeBeats(track(141.7, 0.37, 60), 22050, 144);
    expect(Math.abs(g.bpm - 141.7)).toBeLessThan(0.05);
    expect(Math.abs(g.downbeat - 0.37)).toBeLessThan(0.012);
    expect(g.jitterMs).toBeLessThan(MAX_JITTER_MS);
  });

  test("a busy mix: bass, snare, 16th hats and a noise floor", () => {
    const g = analyzeBeats(busy(146.3, 1.02, 60), 22050, 144);
    expect(Math.abs(g.bpm - 146.3)).toBeLessThan(0.05);
    expect(Math.abs(g.downbeat - 1.02)).toBeLessThan(0.012);
    expect(g.jitterMs).toBeLessThan(MAX_JITTER_MS);
  });

  test("the same mix at a fifth of the level", () => {
    const g = analyzeBeats(busy(146.3, 1.02, 60).map((x) => x * 0.2), 22050, 144);
    expect(Math.abs(g.bpm - 146.3)).toBeLessThan(0.05);
    expect(Math.abs(g.downbeat - 1.02)).toBeLessThan(0.012);
  });

  test("a downbeat late in the bar is found, not the first kick", () => {
    // The track opens on beat 3: the first downbeat is two beats in.
    const bpm = 128, beat = 60 / bpm;
    const g = analyzeBeats(track(bpm, 0.2 + 2 * beat, 45), 22050, 128);
    expect(Math.abs(g.downbeat - (0.2 + 2 * beat))).toBeLessThan(0.012);
  });

  test("noise has no grid: its onsets scatter past the limit", () => {
    let seed = 7;
    const n = new Float32Array(22050 * 30).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
    expect(analyzeBeats(n, 22050, 144).jitterMs).toBeGreaterThan(MAX_JITTER_MS);
  });

  test("loop region: whole phrases from a downbeat, past the intro, clear of the tail", () => {
    const r = loopRegion({ bpm: 144, downbeat: 0.5, jitterMs: 0 }, 120);
    if (!r) throw new Error("no loop");
    expect(r.barSeconds).toBeCloseTo(240 / 144, 9);
    expect(r.start).toBeCloseTo(0.5 + 8 * r.barSeconds, 9);
    expect(r.bars % 8).toBe(0);
    expect(r.bars).toBe(32);
    expect(r.start + r.bars * r.barSeconds).toBeLessThanOrEqual(120 - 8);
  });

  test("loop region: a short track starts at the top; too short is null", () => {
    const short = loopRegion({ bpm: 144, downbeat: 0.5, jitterMs: 0 }, 30);
    expect(short?.start).toBe(0.5);
    expect(short?.bars).toBe(8);
    expect(loopRegion({ bpm: 144, downbeat: 0.5, jitterMs: 0 }, 15)).toBeNull();
  });
});
