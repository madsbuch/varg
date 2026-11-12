import { describe, expect, test } from "bun:test";
import { loopFromBeats, loudestWindow, MAX_JITTER_MS, MIN_DROP_DB } from "../src/lib/beatgrid";

const SR = 1000; // levels only need a coarse signal

/** Beats the way the network reports them: on 20 ms frames, every 4th a downbeat. */
function grid(bpm: number, first: number, from: number, to: number) {
  const beats: number[] = [], downbeats: number[] = [];
  for (let k = 0; first + (k * 60) / bpm < to; k++) {
    const t = Math.round((first + (k * 60) / bpm) * 50) / 50;
    if (t < from) continue;
    beats.push(t);
    if (k % 4 === 0) downbeats.push(t);
  }
  return { beats, downbeats };
}

/** A level track: `base` everywhere, `loud` inside the given windows. */
function level(seconds: number, loud: [number, number][] = [], base = 0.1, high = 0.5): Float32Array {
  return Float32Array.from({ length: seconds * SR }, (_, i) => (loud.some(([a, b]) => i / SR >= a && i / SR < b) ? high : base));
}

describe("loop from the network's beats", () => {
  test("a steady track: the longest loop, on a downbeat, at its own tempo", () => {
    const { beats, downbeats } = grid(143.95, 0.42, 0, 120);
    const { loop } = loopFromBeats(beats, downbeats, level(120), SR, 144, 16);
    if (!loop) throw new Error("no loop");
    expect(loop.bars).toBe(16);
    expect(Math.abs(loop.bpm - 143.95)).toBeLessThan(0.05);
    expect(downbeats.some((d) => Math.abs(d - loop.start) < 0.012)).toBe(true);
    expect(loop.jitterMs).toBeLessThan(MAX_JITTER_MS);
  });

  test("the loudest steady section wins, not the first", () => {
    const { beats, downbeats } = grid(156, 0.3, 0, 120);
    const { loop } = loopFromBeats(beats, downbeats, level(120, [[60, 100]]), SR, 156, 16);
    if (!loop) throw new Error("no loop");
    expect(loop.start).toBeGreaterThanOrEqual(59.9);
    expect(loop.start + (loop.bars * 240) / loop.bpm).toBeLessThanOrEqual(100.1);
  });

  test("an intro without a beat is skipped", () => {
    const { beats, downbeats } = grid(144, 0.5, 25, 120);
    const { loop } = loopFromBeats(beats, downbeats, level(120), SR, 144, 16);
    expect(loop?.start).toBeGreaterThanOrEqual(25);
  });

  test("a section with a dropped beat does not qualify", () => {
    const g = grid(144, 0.5, 0, 40);
    // Drop one beat at ~10 s: no 16 steady bars are left before or after it
    // in 40 s except from 10 s on (26.7 s from 10.4 fits up to 37.1).
    const gap = g.beats.findIndex((b) => b > 10);
    const beats = g.beats.filter((_, i) => i !== gap);
    const { loop } = loopFromBeats(beats, g.downbeats.filter((d) => beats.includes(d)), level(40), SR, 144, 16);
    if (!loop) throw new Error("no loop");
    expect(loop.start).toBeGreaterThan(10);
  });

  test("downbeats that wander off the one are refused", () => {
    const { beats } = grid(144, 0.5, 0, 60);
    // The network's downbeats every 3 beats: no consistent bar.
    const downbeats = beats.filter((_, i) => i % 3 === 0);
    const r = loopFromBeats(beats, downbeats, level(60), SR, 144, 16);
    expect(r.loop).toBeNull();
    expect(r.why).toContain("beats");
  });

  test("a tempo far from the song's is refused, with the numbers", () => {
    const { beats, downbeats } = grid(120, 0.5, 0, 60);
    const r = loopFromBeats(beats, downbeats, level(60), SR, 144, 16);
    expect(r.loop).toBeNull();
    expect(r.why).toContain("~120.0 BPM");
  });

  test("the loudest window is where the model looks first", () => {
    expect(loudestWindow(level(120, [[70, 100]]), SR, 29.76)).toBeCloseTo(70, 0);
    expect(loudestWindow(level(20), SR, 29.76)).toBe(0);
  });

  test("a peak song loops from its drop: the bar where it suddenly gets loud", () => {
    // A steady beat throughout; quiet build until 60.3 s, then the drop.
    const { beats, downbeats } = grid(156, 0.3, 0, 120);
    const drop = downbeats.find((d) => d > 60) ?? 0;
    const levels = level(120, [[drop, 120]], 0.05, 0.5);
    const { loop } = loopFromBeats(beats, downbeats, levels, SR, 156, 16, { preferDrop: true });
    if (!loop) throw new Error("no loop");
    expect(Math.abs(loop.start - drop)).toBeLessThan(0.03);
    expect(loop.dropDb).toBeGreaterThanOrEqual(MIN_DROP_DB);
  });

  test("a peak song without a drop still gets its loudest loop", () => {
    const { beats, downbeats } = grid(156, 0.3, 0, 120);
    const { loop } = loopFromBeats(beats, downbeats, level(120), SR, 156, 16, { preferDrop: true });
    expect(loop).not.toBeNull();
    expect(loop?.dropDb ?? 99).toBeLessThan(MIN_DROP_DB);
  });

  test("no beats at all: refused, saying so", () => {
    const r = loopFromBeats([], [], level(30), SR, 144, 16);
    expect(r.loop).toBeNull();
    expect(r.why).toContain("0 beats");
  });
});
