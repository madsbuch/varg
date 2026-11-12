import { describe, expect, test } from "bun:test";
import { analyzeBeats, findLoop, MAX_JITTER_MS } from "../src/lib/beatgrid";

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

  test("a whole track with an intro, a breakdown and drift: the steady section is the loop", () => {
    const sr = 22050, seconds = 120;
    // Beat times: an ambient intro to 25 s, then a kick whose tempo drifts
    // from 143 to 145 BPM, with no kick 70-80 s (a breakdown).
    const times: number[] = [];
    for (let t = 25; t < seconds; ) {
      if (t < 70 || t >= 80) times.push(t);
      const bpm = 143 + (2 * (t - 25)) / (seconds - 25);
      t += 60 / bpm;
    }
    const out = new Float32Array(seconds * sr);
    let seed = 3;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < out.length; i++) out[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / sr) + 0.02 * noise();
    times.forEach((t0, k) => {
      const accent = k % 4 === 0 ? 1 : 0.5;
      for (let j = 0; j < 0.15 * sr; j++) {
        const i = Math.round(t0 * sr) + j;
        if (i >= out.length) break;
        out[i] = (out[i] ?? 0) + accent * Math.exp(-j / (0.04 * sr)) * Math.sin((2 * Math.PI * 55 * j) / sr);
        if (j < 0.004 * sr) out[i] = (out[i] ?? 0) + 0.3 * accent * noise();
      }
    });
    // One tempo for the whole track does not fit: the old analysis refused it.
    expect(analyzeBeats(out, sr, 144).jitterMs).toBeGreaterThan(MAX_JITTER_MS);
    const { loop } = findLoop(out, sr, 144);
    if (!loop) throw new Error("no loop");
    // Inside the beat, clear of the breakdown, on a downbeat of the kick.
    const end = loop.start + (loop.bars * 240) / loop.bpm;
    expect(loop.start).toBeGreaterThanOrEqual(25);
    expect(end <= 70 || loop.start >= 80).toBe(true);
    expect(end).toBeLessThanOrEqual(seconds);
    const nearest = times.reduce((best, t) => (Math.abs(t - loop.start) < Math.abs(best - loop.start) ? t : best));
    expect(Math.abs(nearest - loop.start)).toBeLessThan(0.012);
    expect(times.indexOf(nearest) % 4).toBe(0);
    expect(loop.jitterMs).toBeLessThan(MAX_JITTER_MS);
  });

  test("a steady track loops 48 bars at its own tempo", () => {
    const { loop } = findLoop(busy(146.3, 1.02, 120), 22050, 144);
    expect(loop?.bars).toBe(48);
    expect(Math.abs((loop?.bpm ?? 0) - 146.3)).toBeLessThan(0.05);
  });

  test("accented ones: soft beats 2-4 still count as hits", () => {
    // The one at twice the level of the other three: every beat is a hit.
    const { loop } = findLoop(track(146.9, 0.77, 120), 22050, 144);
    expect(loop?.bars).toBe(48);
    expect(loop?.coverage).toBeGreaterThan(0.95);
  });

  test("fills: a bar without the kick every 8 bars still loops 48 bars", () => {
    // Like the owner's real Mid layer (89 % of beats hit): the kick drops
    // out for the last bar of every 8-bar phrase.
    const sr = 22050, bpm = 143.95, beat = 60 / bpm;
    const x = track(bpm, 0.42, 120, sr);
    for (let k = 28; 0.42 + k * beat < 120; k += 32) {
      // Silence the kick region of the four fill beats (a pad stays).
      for (let q = 0; q < 4; q++) {
        const i0 = Math.round((0.42 + (k + q) * beat - 0.01) * sr);
        for (let j = 0; j < beat * sr; j++) if (i0 + j < x.length) x[i0 + j] = 0.02 * Math.sin((2 * Math.PI * 220 * (i0 + j)) / sr);
      }
    }
    const { loop } = findLoop(x, sr, 144);
    expect(loop?.bars).toBe(48);
    expect(loop?.coverage).toBeLessThan(0.9);
    expect(loop?.longestGap).toBeLessThanOrEqual(4);
  });

  test("the loudest steady section is the loop, not the clean opening", () => {
    // The owner heard the start of every track again and again. Here the
    // first 30 s carry the same tight beat at a quarter of the level: the
    // loop must come from the full section after it.
    const sr = 22050;
    const x = busy(144, 0.4, 130, sr);
    for (let i = 0; i < 30 * sr; i++) x[i] = (x[i] ?? 0) * 0.25;
    const { loop } = findLoop(x, sr, 144);
    if (!loop) throw new Error("no loop");
    expect(loop.start).toBeGreaterThanOrEqual(29.9);
    expect(loop.bars).toBe(48);
  });

  test("noise: no loop, and the closest numbers for the log", () => {
    let seed = 7;
    const n = new Float32Array(22050 * 60).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
    const r = findLoop(n, 22050, 144);
    expect(r.loop).toBeNull();
    expect(r.jitterMs).toBeGreaterThan(0);
  });
});
