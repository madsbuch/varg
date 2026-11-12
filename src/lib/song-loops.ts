/**
 * Where each song's loop lives once found, and the background pass that
 * finds them.
 *
 * Finding a loop runs a neural network over the whole track: seconds per
 * song on a phone, too slow for a ride's 10 s lead-in with nine songs. So
 * it runs once per composed track, right after the composer downloads it
 * (and on every app start for any song still without one), and the result
 * (or the refusal) is kept here, keyed by the track's createdAt so a
 * regenerated song is analysed again. A ride then only decodes and cuts.
 */
import type { Loop } from "./beatgrid";
import { findSongLoop, LayerError } from "./mixer";
import { getCachedTrack, musicLog } from "./music";
import { SONGS, songKey } from "./songs";

const KEY = "varg.mixer.loops.v2";

export type LoopResult =
  | { createdAt: string; loop: Loop }
  | { createdAt: string; refused: string; detail: string };

function all(): Record<string, LoopResult | undefined> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, LoopResult | undefined>;
  } catch {
    return {};
  }
}

/** The kept result for a song's current track, if any. */
export function songLoop(songId: string, createdAt: string): LoopResult | undefined {
  const hit = all()[songId];
  return hit?.createdAt === createdAt ? hit : undefined;
}

export function keepSongLoop(songId: string, result: LoopResult): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all(), [songId]: result }));
  } catch {
    // A full localStorage only costs the analysis again next time.
  }
}

const inFlight = new Map<string, Promise<LoopResult>>();

/**
 * Find, keep and log one song's loop (or its refusal). One analysis per
 * track at a time: the background pass and a ride starting meanwhile
 * share it instead of running the model twice.
 */
export function analyzeSong(songId: string, blob: Blob, createdAt: string): Promise<LoopResult> {
  const key = `${songId}@${createdAt}`;
  const running = inFlight.get(key);
  if (running) return running;
  const p = runAnalysis(songId, blob, createdAt).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function runAnalysis(songId: string, blob: Blob, createdAt: string): Promise<LoopResult> {
  const song = SONGS.find((s) => s.id === songId);
  if (!song) throw new Error(`no song ${songId}`);
  // An offline context decodes without a user gesture or a running clock.
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const t0 = Date.now();
  let result: LoopResult;
  try {
    const loop = await findSongLoop(ctx, blob, song);
    result = { createdAt, loop };
    musicLog(
      `Beat model: ${song.name} at ${loop.bpm.toFixed(2)} BPM, ${String(loop.bars)}-bar loop from ` +
      `${loop.start.toFixed(2)} s, ±${loop.jitterMs.toFixed(1)} ms, ` +
      `${(loop.onOne * 100).toFixed(0)} % of downbeats on the one (${((Date.now() - t0) / 1000).toFixed(1)} s).`,
    );
  } catch (e) {
    const refused = e instanceof Error ? e.message : String(e);
    const detail = e instanceof LayerError ? e.detail : "";
    result = { createdAt, refused, detail };
    musicLog(`Beat model refused ${refused}${detail ? ` (${detail})` : ""}.`);
  }
  keepSongLoop(songId, result);
  return result;
}

let running = false;

/** Analyse every composed song still without a kept result. Safe to call often. */
export async function ensureSongLoops(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const song of SONGS) {
      const track = await getCachedTrack(songKey(song.id)).catch(() => undefined);
      if (!track || songLoop(song.id, track.createdAt)) continue;
      await analyzeSong(song.id, track.blob, track.createdAt);
    }
  } finally {
    running = false;
  }
}
