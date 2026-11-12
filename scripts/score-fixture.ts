/**
 * The score fixture the native renderer is tested against
 * (src-tauri/plugins/varg-bike/android/src/test: MusicMixerTest). Low then
 * Mid then Peak, back to back, as the app would book them; songs of 4 s
 * lead-up and a 2 s loop at 48 kHz. `bun run scripts/score-fixture.ts`
 * rewrites it; scripts/score.test.ts fails while it is out of date.
 */
import { writeFileSync } from "fs";
import { scoreVoices } from "../src/lib/score";
import type { ScoreSong } from "../src/lib/score";

export const FIXTURE = new URL("../src-tauri/plugins/varg-bike/android/src/test/resources/score-fixture.json", import.meta.url);

export function fixtureScore() {
  const song = (id: string, bpm: number, rate: number): ScoreSong => ({ id, bpm, rate, trim: 1, pre: 4, duration: 6 });
  const songs = new Map([["L", song("L", 144, 1)], ["M", song("M", 144, 1.02)], ["P", song("P", 156, 0.98)]]);
  const T = 10_000;
  const voices = scoreVoices([], [
    { songId: "L", at: T, until: T + 20_000 },
    { songId: "M", at: T + 20_000, until: T + 40_000 },
    { songId: "P", at: T + 40_000, until: T + 60_000 },
  ], songs, 0, false, T);
  return { voices };
}

if (import.meta.main) {
  writeFileSync(FIXTURE, JSON.stringify(fixtureScore(), null, 1) + "\n");
  console.log("wrote", FIXTURE.pathname);
}
