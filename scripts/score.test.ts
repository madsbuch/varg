import { describe, expect, test } from "bun:test";
import { CUT_S, HP_HOLD, HP_OPEN, positionAt, scoreVoices, valueAt, XF_S } from "../src/lib/score";
import type { Booking, ScoreSong, Voice } from "../src/lib/score";

const song = (id: string, bpm = 144): ScoreSong => ({ id, bpm, rate: 1.01, trim: 0.5, pre: 4, duration: 4 + 26.7 });
const songs = new Map([["L", song("L")], ["M", song("M")], ["P", song("P", 156)]]);
const T = 1_000_000; // ride time 0, wall ms
const ride: Booking[] = [
  { songId: "L", at: T, until: T + 20_000 },
  { songId: "M", at: T + 20_000, until: T + 40_000 },
  { songId: "P", at: T + 40_000, until: T + 60_000 },
];
const byId = (s: Voice[], id: string) => s.find((v) => v.songId === id && !v.cut);

describe("the music score", () => {
  test("a song comes in over the 3-2-1, bar 1 on its block's first beat", () => {
    const s = scoreVoices([], ride, songs, T - 10_000, false, T);
    const m = byId(s, "M");
    if (!m) throw new Error("no M");
    expect(m.start).toBe(T + 20_000 - XF_S * 1000);
    // Bar 1 (the buffer at `pre`) plays exactly at the block's start.
    expect(positionAt(m, T + 20_000)).toBeCloseTo(4, 9);
    // Silent until the 3-2-1, full on the one; low end held until then.
    expect(valueAt(m.gain, T + 16_000)).toBe(0);
    expect(valueAt(m.gain, T + 20_000)).toBeCloseTo(1, 9);
    expect(valueAt(m.hp, T + 19_000)).toBe(HP_HOLD);
    expect(valueAt(m.hp, T + 20_100)).toBe(HP_OPEN);
  });

  test("the outgoing song fades over the same 3 s and stops at the change", () => {
    const s = scoreVoices([], ride, songs, T - 10_000, false, T);
    const l = byId(s, "L");
    if (!l) throw new Error("no L");
    expect(valueAt(l.gain, T + 16_900)).toBe(1);
    expect(valueAt(l.gain, T + 20_000)).toBeCloseTo(0, 9);
    expect(l.stop).toBe(T + 20_020);
  });

  test("only the ride's first block starts before its 3-2-1: with the lead-in", () => {
    const s = scoreVoices([], ride, songs, T - 10_000, false, T);
    expect(byId(s, "L")?.start).toBe(T - 10_000 + 50);
    expect(valueAt(byId(s, "L")?.gain ?? [], T - 5_000)).toBe(1);
    // A block with nothing booked before it (its song not loaded) waits
    // for its own 3-2-1: songs never stack.
    const gap = scoreVoices([], [ride[0] as Booking, ride[2] as Booking], songs, T - 10_000, false, T);
    expect(byId(gap, "P")?.start).toBe(T + 40_000 - XF_S * 1000);
  });

  test("a rebook keeps every continuing voice exactly: no seam", () => {
    const a = scoreVoices([], ride, songs, T - 10_000, false, T);
    const b = scoreVoices(a, ride.slice(1), songs, T + 20_000, false, T + 20_000);
    for (const id of ["M", "P"]) expect(byId(b, id)).toEqual(byId(a, id));
  });

  test("a skip moves the end: same song, same place, a new fade", () => {
    const a = scoreVoices([], ride, songs, T - 10_000, false, T);
    const skipAt = T + 25_000;
    const moved: Booking[] = [{ songId: "M", at: T + 20_000, until: skipAt }, { songId: "P", at: skipAt, until: skipAt + 20_000 }];
    const b = scoreVoices(a, moved, songs, T + 24_000, false, T + 20_000);
    const m0 = byId(a, "M"), m1 = byId(b, "M");
    expect(m1?.start).toBe(m0?.start);
    expect(m1?.offset).toBe(m0?.offset);
    expect(m1?.stop).toBe(skipAt + 20);
    expect(valueAt(m1?.gain ?? [], skipAt)).toBeCloseTo(0, 9);
    // The old P booking (at 40 s) is cut; the new one starts at the skip.
    expect(b.filter((v) => v.songId === "P" && !v.cut)[0]?.at).toBe(skipAt);
  });

  test("pause cuts everything within CUT_S; cut voices fall away after", () => {
    const a = scoreVoices([], ride, songs, T - 10_000, false, T);
    const now = T + 5_000;
    const p = scoreVoices(a, ride, songs, now, true, T);
    for (const v of p) {
      expect(v.cut).toBe(true);
      expect(valueAt(v.gain, now + CUT_S * 1000)).toBe(0);
    }
    expect(scoreVoices(p, [], songs, now + 1_000, true, T)).toEqual([]);
  });

  test("the loop wraps from its end to its start, never into the lead-up", () => {
    const v = byId(scoreVoices([], ride, songs, T - 10_000, false, T), "L");
    if (!v) throw new Error("no L");
    const loopLen = v.loopEnd - v.loopStart;
    const t = T + ((loopLen + 1) / v.rate) * 1000; // past one full loop
    expect(positionAt(v, t)).toBeGreaterThanOrEqual(v.loopStart);
    expect(positionAt(v, t)).toBeCloseTo(v.loopStart + 1, 6);
  });
});

describe("the native renderer's fixture", () => {
  test("is the score the app computes today", async () => {
    const { readFileSync } = await import("fs");
    const { FIXTURE, fixtureScore } = await import("./score-fixture");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(fixtureScore())));
  });
});
