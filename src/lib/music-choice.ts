/**
 * What a workout plays: the owner's choice, per workout, or the default
 * he set for all of them (the Music screen in Skipan).
 *
 *  - Its own track: the one battle track composed for this workout,
 *    looped. Not for an adaptive ride, which has none: it plays its set.
 *  - One set: the workout rotates that set's songs, so the music stays one
 *    sound from start to finish, following the workout's shape
 *    (workout-music.ts: warm-up Low, the rest High).
 *  - Shuffle: a different set each time, still one set per workout.
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
  | { mode: "track" }
  | { mode: "set"; set: SetId }
  | { mode: "shuffle" }
  | { mode: "custom"; songs: Record<Intensity, string[]> };

/** A choice that plays songs from the library: everything but the own track. */
export type SongChoice = Exclude<MixChoice, { mode: "track" }>;

export type Mix = Record<Intensity, string[]>;

const KEY = "varg.music.choice.v1";
const DEFAULT_KEY = "varg.music.default.v1";

function all(): Record<string, MixChoice | undefined> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, MixChoice | undefined>;
  } catch {
    return {};
  }
}

/** A stored choice that still makes sense: a set that exists, a known mode. */
function valid(c: MixChoice | undefined): MixChoice | undefined {
  if (!c) return undefined;
  if (c.mode === "set") return setById(c.set) ? c : undefined;
  // Stored JSON: the mode is whatever was written, not what the type says.
  const mode: string = c.mode;
  return ["track", "shuffle", "custom"].includes(mode) ? c : undefined;
}

/**
 * The default for every workout without a choice of its own: the own
 * track, one set, or shuffle. Until the owner picks one, each workout
 * plays its own track, as before there was a choice.
 */
export function loadDefaultChoice(): MixChoice {
  try {
    const c = valid(JSON.parse(localStorage.getItem(DEFAULT_KEY) ?? "null") as MixChoice | undefined);
    if (c && c.mode !== "custom") return c;
  } catch {
    // fall through
  }
  return { mode: "track" };
}

export function saveDefaultChoice(choice: MixChoice): void {
  localStorage.setItem(DEFAULT_KEY, JSON.stringify(choice));
}

/** This workout's own choice, if the owner made one (else it follows the default). */
export function loadOwnChoice(templateId: string): MixChoice | undefined {
  return valid(all()[templateId]);
}

/**
 * What a workout plays: its own choice, else the default. An adaptive ride
 * has no track of its own, so "own track" there means its authored set
 * (`rideSet`, the template's music.set).
 */
export function loadMixChoice(templateId: string, rideSet?: SetId): MixChoice {
  const c = loadOwnChoice(templateId) ?? loadDefaultChoice();
  if (c.mode === "track" && rideSet) return { mode: "set", set: rideSet };
  return c;
}

export function saveMixChoice(templateId: string, choice: MixChoice): void {
  localStorage.setItem(KEY, JSON.stringify({ ...all(), [templateId]: choice }));
}

/** Back to following the default. */
export function clearMixChoice(templateId: string): void {
  const rest = Object.fromEntries(Object.entries(all()).filter(([k]) => k !== templateId));
  localStorage.setItem(KEY, JSON.stringify(rest));
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
export function resolveMix(choice: SongChoice, seed: number): { mix: Mix; set: SetId | null } {
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
