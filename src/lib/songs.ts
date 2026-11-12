/**
 * The song library: sets of songs the adaptive mixer plays.
 *
 * A set is a family written to belong together: one sound, one key, and
 * Low, Mid and Peak songs that are the same night out at different energy.
 * A ride plays one set (the owner picks which per workout, music-choice.ts),
 * rotating its songs block by block, so it never lurches from jazz to
 * hardcore. Every set has two built-in songs per intensity.
 *
 * Built-in songs are authored here, like templates. The owner adds his own
 * in the app (`addUserSong`): those live on the phone and are composed,
 * analysed and mixed exactly like these. Either way, what the mixer needs
 * is not the author's to choose: the tempo comes from the set and the
 * intensity, the key is the library's, and the prompt always asks for a
 * kick on every beat with no intro (music.ts buildSongStyle).
 */
import type { Intensity } from "../types";

export type SetId = "techno" | "jazz-house" | "anthems";

export interface SongSet {
  id: SetId;
  name: string;
  /** What it sounds like, for the library and the picker. */
  sound: string;
  /**
   * Tempo per intensity. Every timed block of every adaptive ride must be
   * whole bars at each (smoke test): 20 s is 12 bars at 144 and 13 at 156.
   */
  bpm: Record<Intensity, number>;
}

export const SETS: readonly SongSet[] = [
  { id: "techno", name: "Techno", sound: "Deep minimal to hard techno", bpm: { 1: 144, 2: 144, 3: 156 } },
  { id: "jazz-house", name: "Jazz house", sound: "Rhodes and brass to a big-band drop", bpm: { 1: 144, 2: 144, 3: 156 } },
  { id: "anthems", name: "Anthems", sound: "Hymns and chants to a shouting choir", bpm: { 1: 144, 2: 144, 3: 156 } },
];

/** The key every song is written in, so songs cross in tune. */
export const LIBRARY_KEY = "A minor";

export interface Song {
  /** Permanent: the cache key of the composed track. Never rename or reuse. */
  id: string;
  name: string;
  set: SetId;
  intensity: Intensity;
  /** From the set and the intensity, never chosen per song. */
  bpm: number;
  /** Suno style: genre, instruments, mood. */
  style: string;
  /** Sung words, in Suno's lyric format. Without them the song is instrumental. */
  lyrics?: string | undefined;
  /** Made in the app by the owner (stored on the phone), not built in. */
  user?: true | undefined;
}

export const INTENSITY_NAMES: Record<Intensity, string> = { 1: "Low", 2: "Mid", 3: "Peak" };

export function setById(id: string): SongSet | undefined {
  return SETS.find((s) => s.id === id);
}

function song(id: string, name: string, set: SetId, intensity: Intensity, style: string, lyrics?: string): Song {
  const bpm = setById(set)?.bpm[intensity] ?? 144;
  return { id, name, set, intensity, bpm, style, ...(lyrics ? { lyrics } : {}) };
}

const BUILT_IN: readonly Song[] = [
  // --- Techno -----------------------------------------------------------------
  song("low-deep-minimal", "Deep minimal", "techno", 1,
    "minimal deep tech house, sparse and hypnotic, steady deep kick, deep sub bass, " +
    "quiet shakers, dark filtered pads, no claps, no lead, no risers"),
  song("low-dub-techno", "Dub techno", "techno", 1,
    "dub techno, steady muffled kick, echoing chord stabs drifting in delay, warm " +
    "sub bass, tape hiss, hypnotic and patient"),
  song("mid-melodic-techno", "Melodic techno", "techno", 2,
    "melodic techno, rolling arpeggiated bass, wide cinematic synth pads, crisp " +
    "percussion, steady kick, building and driving"),
  song("mid-tech-house", "Tech house", "techno", 2,
    "driving tech house groove, rolling bassline, claps on 2 and 4, open hi-hats, " +
    "percussive synth stabs, bouncy and confident"),
  song("peak-hard-techno", "Hard techno", "techno", 3,
    "peak-time hard techno drop, distorted pounding kick, huge rumbling bass, " +
    "screaming supersaw lead, crash cymbals, rave stabs, euphoric and explosive"),
  song("peak-industrial-techno", "Industrial techno", "techno", 3,
    "industrial techno, metallic distorted kick, grinding acid bassline, clanging " +
    "percussion, warehouse reverb, relentless and dark"),
  // --- Jazz house -------------------------------------------------------------
  song("low-jazz-house", "Jazz house", "jazz-house", 1,
    "jazz house, warm Rhodes chords, walking upright bass, muted trumpet licks, " +
    "brushed hi-hats over a steady deep kick, loose and smoky, late-night club"),
  song("low-smoky-rhodes", "Smoky Rhodes", "jazz-house", 1,
    "deep jazzy house, smoky Rhodes and vibraphone, soft upright bass, gentle " +
    "shaker, steady soft kick, after-hours lounge"),
  song("mid-disco-house", "Disco house", "jazz-house", 2,
    "funky disco house, slap bass, chopped filtered guitar, string stabs, claps, " +
    "four-on-the-floor kick, bright and strutting"),
  song("mid-brass-groove", "Brass groove", "jazz-house", 2,
    "nu-jazz house groove, punchy horn section riffs, funky bass, congas, " +
    "four-on-the-floor kick, swinging and confident"),
  song("peak-big-band-drop", "Big-band drop", "jazz-house", 3,
    "electro swing house drop, full big band blasting, screaming trumpets, " +
    "pounding kick, huge brass stabs, wild and euphoric"),
  song("peak-swing-house", "Swing house", "jazz-house", 3,
    "high-energy swing house, honking saxophone lead, stomping kick, walking " +
    "bass turned up loud, brass hits on every bar, all-out party"),
  // --- Anthems ----------------------------------------------------------------
  song("low-anthem-hymn", "Hymn", "anthems", 1,
    "soft choir hymn over a steady deep kick, warm organ pads, distant voices, " +
    "solemn and patient, quiet before the storm",
    "[Verse]\nSteady now, breathe it in\nHold the line, the work begins\n\n" +
    "[Verse]\nSlow and strong, keep it low\nSave the fire, let it grow"),
  song("low-anthem-intro", "Anthem intro", "anthems", 1,
    "cinematic anthem intro, steady kick, low strings, soft taiko, humming " +
    "choir, restrained and rising"),
  song("mid-anthem-chant", "Chant", "anthems", 2,
    "stadium chant groove, gang vocal chant, stomp-clap rhythm on a steady kick, " +
    "big toms, confident and rising",
    "[Chant]\nStand up! Stand up!\nOne more, one more!\n\n" +
    "[Chant]\nStand up! Stand up!\nHold it, hold it!"),
  song("mid-anthem-build", "Build-up", "anthems", 2,
    "epic anthem build-up, choir oohs, pulsing synth bass, steady kick, rising " +
    "strings, drums gathering, tension climbing"),
  song("peak-choir-come-on", "Choir · Come on", "anthems", 3,
    "epic hard dance anthem, massive gang choir shouting, stadium energy, pounding " +
    "kick, huge supersaw chords, war drums, triumphant and relentless",
    "[Chorus]\nCome on! Come on!\nCome on! Come on!\nHarder! Faster!\nDon't you stop now!\n\n" +
    "[Verse]\nLegs on fire, heart like a drum\nEvery second, here it comes\n\n" +
    "[Chorus]\nCome on! Come on!\nCome on! Come on!\nHarder! Faster!\nDon't you stop now!\n\n" +
    "[Chant]\nCome on! Come on! Come on! Come on!"),
  song("peak-rave-push", "Rave · Push", "anthems", 3,
    "big room rave anthem, shouted crowd chant, siren synths, hard kick, euphoric " +
    "drop, hands in the air, all-out energy",
    "[Chant]\nPush! Push! Push it all the way!\nHey! Hey! Don't stop now!\n\n" +
    "[Drop]\nPush! Push! Push it all the way!\nHey! Hey! Don't stop now!\n\n" +
    "[Chant]\nAll the way! All the way!\nPush! Push! Don't stop now!"),
];

/** The built-in songs, for the smoke test. */
export const BUILT_IN_SONGS = BUILT_IN;

/* ------------------------------ The owner's songs --------------------------- */

const USER_KEY = "varg.songs.user.v1";
const listeners = new Set<() => void>();

/** Subscribe to the library changing (a song added or deleted). */
export function onSongsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function userSongs(): Song[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) ?? "[]") as Song[];
    // Tempo always follows the set: re-derive rather than trust storage.
    return raw.map((s) => ({ ...s, bpm: setById(s.set)?.bpm[s.intensity] ?? s.bpm, user: true as const }));
  } catch {
    return [];
  }
}

/** Every song: built in, then the owner's. */
export function allSongs(): Song[] {
  return [...BUILT_IN, ...userSongs()];
}

export function songById(id: string): Song | undefined {
  return allSongs().find((s) => s.id === id);
}

export function songsIn(set: SetId, intensity: Intensity): Song[] {
  return allSongs().filter((s) => s.set === set && s.intensity === intensity);
}

export interface NewSong {
  name: string;
  set: SetId;
  intensity: Intensity;
  style: string;
  lyrics?: string | undefined;
}

/** Why a new song cannot be made, or null. Labels, for the form. */
export function newSongProblem(s: NewSong): string | null {
  if (!s.name.trim()) return "Name it";
  if (s.name.trim().length > 40) return "Name: 40 characters at most";
  if (!setById(s.set)) return "Pick a set";
  if (s.style.trim().length < 10) return "Describe the sound";
  if (s.style.trim().length > 400) return "Sound: 400 characters at most";
  if ((s.lyrics ?? "").length > 2000) return "Lyrics: 2000 characters at most";
  return null;
}

/**
 * Lyrics as Suno wants them: sections in [brackets]. Plain lines get a
 * [Verse] tag so they are sung, not read as instructions.
 */
export function normaliseLyrics(text: string | undefined): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.startsWith("[") ? t : `[Verse]\n${t}`;
}

/** Add the owner's song to the library. The composer picks it up from there. */
export function addUserSong(s: NewSong): Song {
  const problem = newSongProblem(s);
  if (problem) throw new Error(problem);
  const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const lyrics = normaliseLyrics(s.lyrics);
  const created: Song = {
    id,
    name: s.name.trim(),
    set: s.set,
    intensity: s.intensity,
    bpm: setById(s.set)?.bpm[s.intensity] ?? 144,
    style: s.style.trim(),
    ...(lyrics ? { lyrics } : {}),
    user: true,
  };
  localStorage.setItem(USER_KEY, JSON.stringify([...userSongs(), created]));
  listeners.forEach((fn) => { fn(); });
  return created;
}

/** Remove one of the owner's songs. Built-in songs cannot be deleted. */
export function deleteUserSong(id: string): void {
  localStorage.setItem(USER_KEY, JSON.stringify(userSongs().filter((s) => s.id !== id)));
  listeners.forEach((fn) => { fn(); });
}

/** Cache key of a song's composed track. */
export function songKey(id: string): string {
  return `song:${id}`;
}

/** The song behind a cache key, if it is one. */
export function songForKey(key: string): Song | undefined {
  return key.startsWith("song:") ? songById(key.slice(5)) : undefined;
}
