// Workout music via Suno, generated to match each workout's bpm/style/theme.
//
// Suno has no official public API, so this talks to a Suno API gateway
// (default: sunoapi.org) using the user's own API key. The gateway URL is
// configurable so any service exposing the same /api/v1/generate shape works.
//
// Every finished track is downloaded and cached in IndexedDB keyed by
// workout, so a track is generated exactly once per workout.

import type { MusicProfile } from "../types";
import { seedTemplates } from "./seed";

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
      return {
        apiKey: p.apiKey ?? "",
        baseUrl: p.baseUrl?.trim() ? p.baseUrl : DEFAULT_BASE_URL,
      };
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

export function musicProfileFor(templateId?: string): MusicProfile {
  const tpl = templateId
    ? seedTemplates().find((t) => t.id === templateId)
    : undefined;
  return tpl?.music ?? FREESTYLE_PROFILE;
}

/* --------------------------- Auto-generation ----------------------------- */
// Once an API key is saved, every workout gets its fitting track composed
// automatically in the background — one at a time, cached forever, so each
// track costs exactly one generation.

export interface EnsureStatus {
  running: boolean;
  ready: number;
  total: number;
  current?: string | undefined; // workout currently being composed
  error?: string | undefined; // why the run stopped early
}

let ensureRunning = false;
let lastStatus: EnsureStatus = { running: false, ready: 0, total: 0 };
const listeners = new Set<(s: EnsureStatus) => void>();

function emit(s: EnsureStatus): void {
  lastStatus = s;
  listeners.forEach((fn) => { fn(s); });
}

/** Subscribe to auto-generation progress; fires immediately with the
 * latest status. Returns an unsubscribe function. */
export function onEnsureStatus(fn: (s: EnsureStatus) => void): () => void {
  listeners.add(fn);
  fn(lastStatus);
  return () => listeners.delete(fn);
}

function allWorkouts(): { key: string; name: string; profile: MusicProfile }[] {
  return [
    ...seedTemplates().map((t) => ({
      key: t.id,
      name: t.name,
      profile: t.music,
    })),
    { key: "freestyle", name: "Freestyle session", profile: FREESTYLE_PROFILE },
  ];
}

/** Generate any missing workout tracks. Safe to call often — no-ops when
 * already running, when no API key is set, or when everything is cached. */
export async function ensureAllTracks(): Promise<void> {
  if (ensureRunning) return;
  if (!loadMusicSettings().apiKey) return;

  const workouts = allWorkouts();
  const missing: typeof workouts = [];
  for (const w of workouts) {
    if (!(await getCachedTrack(w.key))) missing.push(w);
  }
  const total = workouts.length;
  let ready = total - missing.length;
  if (missing.length === 0) {
    emit({ running: false, ready, total });
    return;
  }

  ensureRunning = true;
  let error: string | undefined;
  try {
    for (const w of missing) {
      emit({ running: true, ready, total, current: w.name });
      try {
        await generateTrack(w.key, w.name, w.profile, loadMusicSettings(), () => undefined);
        ready++;
      } catch (e) {
        // Bad key / no credits / offline: stop and retry on next launch
        // instead of burning a failed request per workout.
        error = e instanceof Error ? e.message : "Track generation failed.";
        break;
      }
    }
  } finally {
    ensureRunning = false;
    emit({ running: false, ready, total, error });
  }
}

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
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error("IndexedDB open failed")); };
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
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { reject(req.error ?? new Error("IndexedDB request failed")); };
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
  data?: T | undefined;
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
      // The gateway requires a callback URL even though we poll for the
      // result; example.com is IANA-reserved and discards the POST.
      callBackUrl: "https://example.com/varg-suno-callback",
    }),
  });
  const created = (await createRes
    .json()
    .catch(() => null)) as GatewayResponse<{ taskId?: string }> | null;
  const taskId =
    createRes.ok && created?.code === 200 ? created.data?.taskId : undefined;
  if (taskId == null) {
    const msg = created?.msg;
    throw new Error(
      msg?.trim() ? msg : `Generation request failed (HTTP ${createRes.status}).`,
    );
  }

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

    // A failed callback delivery (we don't host one) can surface as
    // CALLBACK_EXCEPTION even though the track itself is done — so treat
    // any terminal status with an audio URL as success.
    const song = poll?.data?.response?.sunoData?.[0];
    if (status === "SUCCESS" || (status === "CALLBACK_EXCEPTION" && song?.audioUrl)) {
      if (!song?.audioUrl) {
        throw new Error("Track finished but the gateway returned no audio URL.");
      }
      onStatus("Downloading track…");
      const audio = await fetch(song.audioUrl);
      if (!audio.ok) throw new Error("Could not download the finished track.");
      const track: CachedTrack = {
        key,
        title: song.title?.trim() ? song.title : workoutName,
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
