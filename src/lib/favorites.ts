/**
 * Starred workouts. A per-device preference, like the music settings, so it
 * lives in the settings store (kv.ts), not the training data. Every read and
 * write is guarded: storage can be unavailable or cleared, and a lost star
 * must never break the workout library.
 */
import { kvGet, kvSet } from "./kv";
const KEY = "varg.favorites.v1";

export function loadFavorites(): Set<string> {
  try {
    const raw = kvGet(KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(ids: Set<string>): void {
  try {
    kvSet(KEY, JSON.stringify([...ids]));
  } catch {
    // Not persisted this time; the star still shows for this session.
  }
}
