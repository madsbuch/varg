/**
 * Every song's beat metadata, found in the background and kept.
 *
 * Running the beat model over a track takes seconds on a phone, too slow
 * for a ride's 10 s lead-in with nine songs. So each song is analysed on
 * its own, as soon as its track is downloaded (onTrackCached), on every
 * app start for any song still without metadata, and after a regenerate;
 * a ride only decodes and cuts.
 *
 * The metadata is kept per song, keyed by the track's createdAt so a
 * regenerated song is analysed again: the beats and downbeats the network
 * found (so the loop rules can change without rerunning it), what it read,
 * the loop the mixer plays, or why there is none.
 */
import type { Loop } from "./beatgrid";
import { analyzeTrack, LayerError } from "./mixer";
import { getCachedTrack, musicLog, onTrackCached } from "./music";
import { SONGS, songForKey, songKey } from "./songs";

const KEY = "varg.songs.meta.v1";
export const BEAT_MODEL = "Beat This! small0";

export interface SongMeta {
  createdAt: string;
  analysedAt: string;
  model: string;
  /** Seconds the analysis took on this device. */
  took: number;
  duration: number;
  analysed: [number, number];
  beats: number[];
  downbeats: number[];
  loop: Loop | null;
  /** When there is no loop: a short label and the numbers behind it. */
  refused?: string | undefined;
  detail?: string | undefined;
}

function all(): Record<string, SongMeta | undefined> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, SongMeta | undefined>;
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
const analysing = new Set<string>();

/** Subscribe to metadata changes (an analysis starting or ending). */
export function onSongMeta(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => { listeners.forEach((fn) => { fn(); }); };

/** The metadata for a song's current track, if analysed. */
export function songMeta(songId: string, createdAt: string): SongMeta | undefined {
  const hit = all()[songId];
  return hit?.createdAt === createdAt ? hit : undefined;
}

export function isAnalysing(songId: string): boolean {
  return analysing.has(songId);
}

function keep(songId: string, meta: SongMeta): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all(), [songId]: meta }));
  } catch {
    // A full localStorage only costs the analysis again next time.
  }
}

const inFlight = new Map<string, Promise<SongMeta>>();

/**
 * Analyse one song's track and keep the result. One analysis per track at
 * a time: the background pass and a ride starting meanwhile share it.
 */
export function analyzeSong(songId: string, blob: Blob, createdAt: string): Promise<SongMeta> {
  const key = `${songId}@${createdAt}`;
  const running = inFlight.get(key);
  if (running) return running;
  analysing.add(songId);
  emit();
  const p = run(songId, blob, createdAt).finally(() => {
    inFlight.delete(key);
    analysing.delete(songId);
    emit();
  });
  inFlight.set(key, p);
  return p;
}

async function run(songId: string, blob: Blob, createdAt: string): Promise<SongMeta> {
  const song = SONGS.find((s) => s.id === songId);
  if (!song) throw new Error(`no song ${songId}`);
  // An offline context decodes without a user gesture or a running clock.
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const t0 = Date.now();
  const base = { createdAt, analysedAt: new Date().toISOString(), model: BEAT_MODEL };
  let meta: SongMeta;
  try {
    const r = await analyzeTrack(ctx, blob, song);
    const took = (Date.now() - t0) / 1000;
    meta = {
      ...base, took, duration: r.duration, analysed: r.analysed, beats: r.beats, downbeats: r.downbeats, loop: r.loop,
      ...(r.loop ? {} : { refused: `${song.name}: no steady beat`, detail: r.why }),
    };
    musicLog(
      r.loop
        ? `Beat model: ${song.name} at ${r.loop.bpm.toFixed(2)} BPM, ${String(r.loop.bars)}-bar loop from ` +
          `${r.loop.start.toFixed(2)} s, ±${r.loop.jitterMs.toFixed(1)} ms, ` +
          `${(r.loop.onOne * 100).toFixed(0)} % of downbeats on the one (${took.toFixed(1)} s).`
        : `Beat model refused ${song.name}: no steady beat (${r.why}; ${took.toFixed(1)} s).`,
    );
  } catch (e) {
    const refused = e instanceof Error ? e.message : String(e);
    const detail = e instanceof LayerError ? e.detail : "";
    meta = { ...base, took: (Date.now() - t0) / 1000, duration: 0, analysed: [0, 0], beats: [], downbeats: [], loop: null, refused, detail };
    musicLog(`Beat model refused ${refused}${detail ? ` (${detail})` : ""}.`);
  }
  keep(songId, meta);
  return meta;
}

/** Analyse a song again from scratch (the "Analyse again" button). */
export async function reanalyzeSong(songId: string): Promise<void> {
  const track = await getCachedTrack(songKey(songId)).catch(() => undefined);
  if (track) await analyzeSong(songId, track.blob, track.createdAt);
}

let sweeping = false;

/** Analyse every composed song still without metadata. Safe to call often. */
export async function ensureSongLoops(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const song of SONGS) {
      const track = await getCachedTrack(songKey(song.id)).catch(() => undefined);
      if (!track || songMeta(song.id, track.createdAt)) continue;
      await analyzeSong(song.id, track.blob, track.createdAt);
    }
  } finally {
    sweeping = false;
  }
}

// A song is analysed the moment its track is stored, not after the rest
// of the composing run.
onTrackCached((track) => {
  const song = songForKey(track.key);
  if (song) void analyzeSong(song.id, track.blob, track.createdAt);
});
