// Workout music via Suno, generated to match each workout's bpm/style/theme.
//
// Suno has no official public API, so this talks to a Suno API gateway
// (default: sunoapi.org) using the user's own API key. The gateway URL is
// configurable so any service exposing the same /api/v1/generate shape works.
//
// Every finished track is downloaded and cached in IndexedDB keyed by
// workout, so a track is generated exactly once per workout.

import type { MusicProfile } from "../types";

export const DEFAULT_BASE_URL = "https://api.sunoapi.org";
const SETTINGS_KEY = "varg.music.v1";

export interface MusicSettings {
  apiKey: string;
  baseUrl: string;
}

export function loadMusicSettings(): MusicSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MusicSettings>;
      return { apiKey: p.apiKey ?? "", baseUrl: p.baseUrl || DEFAULT_BASE_URL };
    }
  } catch {
    // fall through to defaults
  }
  return { apiKey: "", baseUrl: DEFAULT_BASE_URL };
}

export function saveMusicSettings(s: MusicSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Profile for sessions that weren't started from a template. */
export const FREESTYLE_PROFILE: MusicProfile = {
  bpm: 150,
  style: "dark electronic rock, heavy driving drums",
  theme: "Wolf on the hunt — raw, relentless training energy",
};

/* ------------------------------ Track cache ------------------------------ */

export interface CachedTrack {
  key: string; // template id, or "freestyle"
  title: string;
  blob: Blob;
  createdAt: string;
}

const DB_NAME = "varg-music";
const STORE = "tracks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function getCachedTrack(key: string): Promise<CachedTrack | undefined> {
  return withStore("readonly", (s) => s.get(key) as IDBRequest<CachedTrack>);
}

export async function putCachedTrack(track: CachedTrack): Promise<void> {
  await withStore("readwrite", (s) => s.put(track));
}

export async function deleteCachedTrack(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

/* ----------------------------- Suno gateway ------------------------------ */

interface GatewayResponse<T> {
  code: number;
  msg: string;
  data: T;
}

interface RecordInfo {
  status: string;
  response?: { sunoData?: { audioUrl?: string; title?: string }[] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate a track for a workout, wait for it, download it, and cache it.
 * Resolves with the cached track; throws with a human-readable message.
 */
export async function generateTrack(
  key: string,
  workoutName: string,
  profile: MusicProfile,
  settings: MusicSettings,
  onStatus: (status: string) => void,
): Promise<CachedTrack> {
  const base = settings.baseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
  };

  const prompt =
    `Instrumental workout track for "${workoutName}". ${profile.theme}. ` +
    `Style: ${profile.style}. Steady ${profile.bpm} BPM, driving rhythm, ` +
    `high energy, no vocals.`;

  onStatus("Requesting track…");
  const createRes = await fetch(`${base}/api/v1/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customMode: false,
      instrumental: true,
      model: "V4_5",
      prompt,
    }),
  });
  const created = (await createRes
    .json()
    .catch(() => null)) as GatewayResponse<{ taskId?: string }> | null;
  if (!createRes.ok || !created || created.code !== 200 || !created.data?.taskId) {
    throw new Error(
      created?.msg || `Generation request failed (HTTP ${createRes.status}).`,
    );
  }
  const taskId = created.data.taskId;

  const deadline = Date.now() + 8 * 60 * 1000;
  onStatus("Composing — usually takes 1–3 minutes…");
  while (Date.now() < deadline) {
    await sleep(10_000);
    const pollRes = await fetch(
      `${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers },
    );
    const poll = (await pollRes
      .json()
      .catch(() => null)) as GatewayResponse<RecordInfo> | null;
    const status = poll?.data?.status ?? "PENDING";

    if (status === "SUCCESS") {
      const song = poll?.data?.response?.sunoData?.[0];
      if (!song?.audioUrl) {
        throw new Error("Track finished but the gateway returned no audio URL.");
      }
      onStatus("Downloading track…");
      const audio = await fetch(song.audioUrl);
      if (!audio.ok) throw new Error("Could not download the finished track.");
      const track: CachedTrack = {
        key,
        title: song.title || workoutName,
        blob: await audio.blob(),
        createdAt: new Date().toISOString(),
      };
      await putCachedTrack(track);
      return track;
    }
    if (
      status.endsWith("FAILED") ||
      status === "CALLBACK_EXCEPTION" ||
      status === "SENSITIVE_WORD_ERROR"
    ) {
      throw new Error(`Generation failed (${status}).`);
    }
  }
  throw new Error("Timed out waiting for the track — try again later.");
}
