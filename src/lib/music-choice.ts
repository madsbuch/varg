/**
 * Which songs an adaptive workout plays: the owner's choice, per workout.
 *
 *  - One set (the default, the template's `music.set`): the ride rotates
 *    that set's songs, so the music stays one sound from start to finish.
 *  - Shuffle: a different set each ride, still one set per ride.
 *  - Custom: songs ticked per intensity, across sets, on purpose.
 *
 * This chooses a soundtrack, not a program: the workout's blocks, timing
 * and targets stay authored in code. Stored on the phone, like the other
 * per-workout music settings.
 */
import type { Intensity } from "../types";
import { allSongs, SETS, setById } from "./songs";
import type { SetId } from "./songs";

export type MixChoice =
  | { mode: "set"; set: SetId }
  | { mode: "shuffle" }
  | { mode: "custom"; songs: Record<Intensity, string[]> };

export type Mix = Record<Intensity, string[]>;

const KEY = "varg.music.choice.v1";

function all(): Record<string, MixChoice | undefined> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, MixChoice | undefined>;
  } catch {
    return {};
  }
}

/** The owner's choice for a workout, or its default set. */
export function loadMixChoice(templateId: string, defaultSet: SetId): MixChoice {
  const c = all()[templateId];
  if (c?.mode === "set" && !setById(c.set)) return { mode: "set", set: defaultSet };
  return c ?? { mode: "set", set: defaultSet };
}

export function saveMixChoice(templateId: string, choice: MixChoice): void {
  localStorage.setItem(KEY, JSON.stringify({ ...all(), [templateId]: choice }));
}

/** Every song of a set, by intensity, built-in first. */
export function setMix(set: SetId): Mix {
  const songs = allSongs().filter((s) => s.set === set);
  const of = (l: Intensity) => songs.filter((s) => s.intensity === l).map((s) => s.id);
  return { 1: of(1), 2: of(2), 3: of(3) };
}

/**
 * The songs a ride plays. `seed` differs per ride: it picks the set when
 * shuffling. Songs since deleted drop out of a custom choice.
 */
export function resolveMix(choice: MixChoice, seed: number): { mix: Mix; set: SetId | null } {
  if (choice.mode === "set") return { mix: setMix(choice.set), set: choice.set };
  if (choice.mode === "shuffle") {
    const set = SETS[seed % SETS.length]?.id ?? "techno";
    return { mix: setMix(set), set };
  }
  const known = new Set(allSongs().map((s) => s.id));
  const keep = (ids: string[]) => ids.filter((id) => known.has(id));
  return { mix: { 1: keep(choice.songs[1]), 2: keep(choice.songs[2]), 3: keep(choice.songs[3]) }, set: null };
}

/** Intensities a ride uses that a choice leaves without songs: the picker's red line. */
export function missingIntensities(choice: MixChoice, used: Intensity[]): Intensity[] {
  if (choice.mode !== "custom") return [];
  const { mix } = resolveMix(choice, 0);
  return used.filter((l) => mix[l].length === 0);
}
