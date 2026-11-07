/**
 * Starred workouts. A per-device preference, like the music settings, so it
 * lives in localStorage rather than the training database. Every read and
 * write is guarded: storage can be unavailable or cleared, and a lost star
 * must never break the workout library.
 */
const KEY = "varg.favorites.v1";

export function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Not persisted this time; the star still shows for this session.
  }
}
