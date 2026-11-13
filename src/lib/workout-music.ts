/**
 * A song set played under a workout that is not an adaptive ride: the
 * guided players (intervals, EMOMs, flows), the for-time player, and rides
 * without intensities of their own.
 *
 * The music follows the workout's shape on a high level only, never its
 * every station: a warm-up plays Low songs, the main part plays its
 * `music.energy` (default Peak), a yoga flow plays Low throughout. A song
 * change at every 20/10 s switch would be noise, and the mixer crossfades
 * over a 3-2-1 that a 10 s rest cannot give it.
 *
 * A long stretch at one intensity does not loop one 16-bar song for 18
 * minutes: it is cut into CHUNK_S blocks, and the n-th block at an
 * intensity plays the n-th song of the set (adaptive-track.ts rotates by
 * `n`, as for a ride's stretches). The blocks become the same MusicPlan a
 * ride hands the mixer, so the same mixer and the same native player play
 * them: songs land bar 1 on a block's first beat and cross over its 3-2-1.
 */
import type { Intensity, Template } from "../types";
import type { MusicBlock, MusicPlan } from "./ride";
import { loadMixChoice, resolveMix } from "./music-choice";
import type { Mix } from "./music-choice";
import { seedTemplates } from "./seed";
import type { WodConfig } from "./wod";

/**
 * Seconds a song plays before the next one takes over within a stretch.
 * A multiple of BAR_GRID_S, so every change is on a whole bar.
 */
export const CHUNK_S = 120;
/**
 * Every set's tempos (144 and 156 BPM) fit a whole number of bars into a
 * multiple of 20 s (12 and 13 bars). A section boundary inside a workout
 * must lie on this grid, or a song change lands off the bar: db:smoke
 * checks the warm-ups.
 */
export const BAR_GRID_S = 20;

/** One part of a workout's music: its intensity, and its length (null: open-ended). */
export interface MusicSection {
  level: Intensity;
  seconds: number | null;
}

/**
 * The main part's intensity: the template's, else Peak — except a ride
 * without intensities of its own, which plays Mid: forty minutes in zone 2
 * on Peak drops would be the music arguing with the workout.
 */
export function mainEnergy(tpl: Template | undefined): Intensity {
  return tpl?.music.energy ?? (tpl?.ride ? 2 : 3);
}

/** A guided workout's sections, from the player's own config (lead-in excluded). */
export function wodSections(cfg: WodConfig, energy: Intensity, total: number): MusicSection[] {
  if (cfg.sequence) return [{ level: 1, seconds: total }];
  const warm = cfg.emom?.warmup.reduce((a, w) => a + w.secs, 0) ?? 0;
  if (warm > 0) return [{ level: 1, seconds: warm }, { level: energy, seconds: total - warm }];
  return [{ level: energy, seconds: total }];
}

/** Sections of a workout with no known end (for time, rides without intensities). */
export function openSections(energy: Intensity): MusicSection[] {
  return [{ level: energy, seconds: null }];
}

/** How far ahead an open-ended workout's music is booked. */
const HORIZON_S = 3 * 60 * 60;

/**
 * The music from `now` (workout seconds) on, as blocks on the wall clock:
 * every section cut into CHUNK_S blocks, numbered per intensity from the
 * start of the workout. `origin` is the wall-clock ms of workout second 0,
 * so a pause or a seek, which moves it, rebooks cleanly.
 */
export function sectionsPlan(sections: MusicSection[], origin: number, now: number, paused: boolean): MusicPlan {
  const plan: MusicPlan = { origin, paused, blocks: [] };
  const count: Partial<Record<Intensity, number>> = {};
  let start = 0;
  for (const sec of sections) {
    const end = sec.seconds === null ? start + HORIZON_S : start + sec.seconds;
    for (let at = start; at < end; at += CHUNK_S) {
      const until = Math.min(end, at + CHUNK_S);
      const n = count[sec.level] ?? 0;
      count[sec.level] = n + 1;
      if (until <= now) continue;
      const block: MusicBlock = { level: sec.level, n, at: origin + at * 1000, until: origin + until * 1000 };
      plan.blocks.push(block);
    }
    start = end;
  }
  return plan;
}

/** Intensities a workout's music uses: what its set must have songs for. */
export function sectionLevels(sections: MusicSection[]): Intensity[] {
  return [...new Set(sections.map((s) => s.level))];
}

/**
 * What a workout plays, decided once when it starts: a mix of songs, or
 * null for its own battle track. `seed` picks the shuffled set and where
 * the rotation starts, so no two workouts open alike.
 */
export function workoutMix(templateId: string | undefined, seed: number): Mix | null {
  if (!templateId) return null;
  const choice = loadMixChoice(templateId);
  if (choice.mode === "track") return null;
  return resolveMix(choice, seed).mix;
}

/** The sections a template's music has, for the picker on its page (lead-in excluded). */
export function templateSections(tpl: Template): MusicSection[] {
  const energy = mainEnergy(tpl);
  if (tpl.flow) return [{ level: 1, seconds: null }];
  const warm = tpl.emom?.warmup?.reduce((a, w) => a + w.seconds, 0) ?? 0;
  if (warm > 0) return [{ level: 1, seconds: warm }, { level: energy, seconds: null }];
  return openSections(energy);
}

export function templateById(id: string | undefined): Template | undefined {
  return id ? seedTemplates().find((t) => t.id === id) : undefined;
}
