/**
 * The song collection: tracks the adaptive mixer plays, shared by every
 * adaptive workout.
 *
 * Like templates, songs are authored in code. Each is composed once on
 * Suno (cached under `songKey`), and any adaptive ride can draw on it: a
 * template's `music.mix` names the songs for each intensity, and the ride
 * rotates through them block by block, so ten rounds are not the same
 * three loops ten times.
 *
 * What every song must give the mixer (enforced in the prompt, checked by
 * the smoke test): one steady tempo, a kick on every beat (the beat grid
 * is found from it), and a key the others share so crossings sit in tune.
 * A ride's every timed block must be whole bars at every song's tempo.
 */
import type { Intensity } from "../types";

export interface Song {
  /** Permanent: the cache key of the composed track. Never rename or reuse. */
  id: string;
  /** Shown on cards and in the log: "Jazz house". */
  name: string;
  intensity: Intensity;
  bpm: number;
  /** Suno style: genre, instruments, mood. */
  style: string;
  /** Sung words, in Suno's lyric format. Without them the song is instrumental. */
  lyrics?: string | undefined;
}

export const INTENSITY_NAMES: Record<Intensity, string> = { 1: "Low", 2: "Mid", 3: "Peak" };

export const SONGS: readonly Song[] = [
  // --- Low: seated, held back -----------------------------------------------
  {
    id: "low-jazz-house",
    name: "Jazz house",
    intensity: 1,
    bpm: 144,
    style:
      "jazz house, warm Rhodes chords, walking upright bass, muted trumpet licks, " +
      "brushed hi-hats over a steady deep kick, loose and smoky, late-night club",
  },
  {
    id: "low-deep-minimal",
    name: "Deep minimal",
    intensity: 1,
    bpm: 144,
    style:
      "minimal deep tech house, sparse and hypnotic, steady deep kick, deep sub bass, " +
      "quiet shakers, dark filtered pads, no claps, no lead, no risers",
  },
  {
    id: "low-dub-techno",
    name: "Dub techno",
    intensity: 1,
    bpm: 144,
    style:
      "dub techno, steady muffled kick, echoing chord stabs drifting in delay, warm " +
      "sub bass, tape hiss, hypnotic and patient",
  },
  // --- Mid: standing, full groove -------------------------------------------
  {
    id: "mid-tech-house",
    name: "Tech house",
    intensity: 2,
    bpm: 144,
    style:
      "driving tech house groove, rolling bassline, claps on 2 and 4, open hi-hats, " +
      "percussive synth stabs, bouncy and confident",
  },
  {
    id: "mid-disco-house",
    name: "Disco house",
    intensity: 2,
    bpm: 144,
    style:
      "funky disco house, slap bass, chopped filtered guitar, string stabs, claps, " +
      "four-on-the-floor kick, bright and strutting",
  },
  {
    id: "mid-melodic-techno",
    name: "Melodic techno",
    intensity: 2,
    bpm: 144,
    style:
      "melodic techno, rolling arpeggiated bass, wide cinematic synth pads, crisp " +
      "percussion, steady kick, building and driving",
  },
  // --- Peak: accelerate, explosive, a little faster -------------------------
  {
    id: "peak-hard-techno",
    name: "Hard techno",
    intensity: 3,
    bpm: 156,
    style:
      "peak-time hard techno drop, distorted pounding kick, huge rumbling bass, " +
      "screaming supersaw lead, crash cymbals, rave stabs, euphoric and explosive",
  },
  {
    id: "peak-choir-come-on",
    name: "Choir · Come on",
    intensity: 3,
    bpm: 156,
    style:
      "epic hard dance anthem, massive gang choir shouting, stadium energy, pounding " +
      "kick, huge supersaw chords, war drums, triumphant and relentless",
    lyrics:
      "[Chorus]\nCome on! Come on!\nCome on! Come on!\nHarder! Faster!\nDon't you stop now!\n\n" +
      "[Verse]\nLegs on fire, heart like a drum\nEvery second, here it comes\n\n" +
      "[Chorus]\nCome on! Come on!\nCome on! Come on!\nHarder! Faster!\nDon't you stop now!\n\n" +
      "[Chant]\nCome on! Come on! Come on! Come on!",
  },
  {
    id: "peak-rave-push",
    name: "Rave · Push",
    intensity: 3,
    bpm: 156,
    style:
      "big room rave anthem, shouted crowd chant, siren synths, hard kick, euphoric " +
      "drop, hands in the air, all-out energy",
    lyrics:
      "[Chant]\nPush! Push! Push it all the way!\nHey! Hey! Don't stop now!\n\n" +
      "[Drop]\nPush! Push! Push it all the way!\nHey! Hey! Don't stop now!\n\n" +
      "[Chant]\nAll the way! All the way!\nPush! Push! Don't stop now!",
  },
];

/** Cache key of a song's composed track. */
export function songKey(id: string): string {
  return `song:${id}`;
}

export function songById(id: string): Song | undefined {
  return SONGS.find((s) => s.id === id);
}

/** The song behind a cache key, if it is one. */
export function songForKey(key: string): Song | undefined {
  return key.startsWith("song:") ? songById(key.slice(5)) : undefined;
}
