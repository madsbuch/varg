/**
 * Starred workouts. A per-device preference, like the music settings, so it
 * lives in the settings store (kv.ts), not the training data. Every read and
 * write is guarded: storage can be unavailable or cleared, and a lost star
 * must never break the workout library.
 */
import { z } from "zod";
import { kvRead, kvSet } from "./kv";
const KEY = "varg.favorites.v1";

export function loadFavorites(): Set<string> {
  return new Set(kvRead(KEY, z.array(z.string())) ?? []);
}

export function saveFavorites(ids: Set<string>): void {
  try {
    kvSet(KEY, JSON.stringify([...ids]));
  } catch {
    // Not persisted this time; the star still shows for this session.
  }
}
