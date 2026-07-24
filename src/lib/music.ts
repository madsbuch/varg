// Workout music via Suno, generated to match each workout's bpm/style/theme.
//
// Suno has no official public API, so this talks to a Suno API gateway
// (default: sunoapi.org) using the user's own API key. The gateway URL is
// configurable so any service exposing the same /api/v1/generate shape works.
//
// Every finished track is downloaded and cached in IndexedDB keyed by
// workout, so a track is generated exactly once per workout.
//
// Generation is standby-safe: requests are submitted first (composing then
// happens on the gateway's servers, phone asleep or not), in-flight taskIds
// are persisted, and results are polled — resumed on every app foreground.

import type { MusicProfile } from "../types";
import { seedTemplates } from "./seed";

export const DEFAULT_BASE_URL = "https://api.sunoapi.org";
export const DEFAULT_MODEL = "V4_5";
export const SUNO_MODELS = ["V4", "V4_5", "V4_5PLUS", "V5"];
const SETTINGS_KEY = "varg.music.v1";
const PROFILES_KEY = "varg.music.profiles.v1";

export interface MusicSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadMusicSettings(): MusicSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MusicSettings>;
      return {
        apiKey: p.apiKey ?? "",
        baseUrl: p.baseUrl?.trim() ? p.baseUrl : DEFAULT_BASE_URL,
        model: p.model?.trim() ? p.model : DEFAULT_MODEL,
      };
    }
  } catch {
    // fall through to defaults
  }
  return { apiKey: "", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL };
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

/* ---------------------- Per-workout profile overrides -------------------- */
// The shipped profiles are defaults; the settings page lets the user tune
// bpm/style/theme per workout. Overrides live in localStorage keyed like
// tracks: template id, or "freestyle".

function loadProfileOverrides(): Record<string, MusicProfile> {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) return JSON.parse(raw) as Record<string, MusicProfile>;
  } catch {
    // fall through
  }
  return {};
}

export function saveProfileOverride(key: string, profile: MusicProfile): void {
  const all = loadProfileOverrides();
  all[key] = profile;
  localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
}

export function clearProfileOverride(key: string): void {
  const all = loadProfileOverrides();
  if (key in all) {
    const remaining = Object.fromEntries(
      Object.entries(all).filter(([k]) => k !== key),
    );
    localStorage.setItem(PROFILES_KEY, JSON.stringify(remaining));
  }
}

/** A workout's music entry: effective profile (override or default). */
export interface WorkoutMusic {
  key: string; // template id, or "freestyle"
  name: string;
  profile: MusicProfile;
  defaultProfile: MusicProfile;
  isCustom: boolean;
}

export function workoutMusicList(): WorkoutMusic[] {
  const overrides = loadProfileOverrides();
  const base = [
    ...seedTemplates().map((t) => ({ key: t.id, name: t.name, music: t.music })),
    { key: "freestyle", name: "Freestyle session", music: FREESTYLE_PROFILE },
  ];
  return base.map((w) => {
    const override = overrides[w.key];
    return {
      key: w.key,
      name: w.name,
      profile: override ?? w.music,
      defaultProfile: w.music,
      isCustom: override !== undefined,
    };
  });
}

export function musicProfileFor(templateId?: string): MusicProfile {
  const key = templateId ?? "freestyle";
  const override = loadProfileOverrides()[key];
  if (override) return override;
  const tpl = templateId
    ? seedTemplates().find((t) => t.id === templateId)
    : undefined;
  return tpl?.music ?? FREESTYLE_PROFILE;
}

/* --------------------------- Auto-generation ----------------------------- */
// Once an API key is saved, every workout gets its fitting track composed
// automatically in the background — cached forever, so each track costs
// exactly one generation.
//
// Standby-safe by design: composing happens on the gateway's servers, not
// on the phone. A run first *submits* a request per missing track (quick),
// then polls for results. Submitted taskIds are persisted, so when Android
// freezes the WebView (screen lock / app backgrounded) nothing is lost —
// the next foreground pass resumes exactly where it left off and downloads
// whatever finished in the meantime.

export interface EnsureStatus {
  running: boolean;
  ready: number;
  total: number;
  pending?: number | undefined; // requests composing on the server right now
  current?: string | undefined; // workout currently being requested
  error?: string | undefined; // why the run stopped early
}

/* ------------------------ In-flight (pending) tasks ---------------------- */
// A generation request is fire-and-forget for the gateway: once submitted,
// it composes server-side whether or not the phone stays awake. Pending
// taskIds live in localStorage so an interrupted run is resumed, not failed.

const PENDING_KEY = "varg.music.pending.v1";
const POLL_INTERVAL_MS = 10_000;
// A task the gateway *confirms* is still pending after this long is dead.
// Only checked right after a successful poll, so a long standby can never
// expire a track that actually finished — it gets polled (and picked up)
// first.
const PENDING_TTL_MS = 30 * 60 * 1000;
// ~2 minutes of consecutive failed polls: stop the run. The requests keep
// composing server-side; the next foreground pass resumes them.
const MAX_UNREACHABLE_ROUNDS = 12;

interface PendingTask {
  key: string; // template id, or "freestyle"
  workoutName: string;
  taskId: string;
  requestedAt: string;
}

function loadPendingTasks(): PendingTask[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) return JSON.parse(raw) as PendingTask[];
  } catch {
    // fall through
  }
  return [];
}

function savePendingTasks(tasks: PendingTask[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(tasks));
}

function addPendingTask(task: PendingTask): void {
  savePendingTasks([
    ...loadPendingTasks().filter((t) => t.key !== task.key),
    task,
  ]);
}

function removePendingTask(key: string): void {
  savePendingTasks(loadPendingTasks().filter((t) => t.key !== key));
}

/* ------------------------------ Composer log ----------------------------- */
// Every step of every generation is recorded here — requests, response
// codes, poll statuses, downloads, and full error bodies — so a failure on
// a phone can be diagnosed from the Settings page instead of guessed at.
// Ring buffer in localStorage; survives restarts.

const LOG_KEY = "varg.music.log.v1";
const LOG_MAX = 250;

export interface MusicLogEntry {
  at: string; // ISO timestamp
  msg: string;
}

const logListeners = new Set<() => void>();

export function readMusicLog(): MusicLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) return JSON.parse(raw) as MusicLogEntry[];
  } catch {
    // fall through
  }
  return [];
}

export function musicLog(msg: string): void {
  try {
    const entries = [...readMusicLog(), { at: new Date().toISOString(), msg }];
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-LOG_MAX)));
  } catch {
    // a full localStorage must never break generation itself
  }
  logListeners.forEach((fn) => { fn(); });
}

export function clearMusicLog(): void {
  localStorage.removeItem(LOG_KEY);
  logListeners.forEach((fn) => { fn(); });
}

/** Subscribe to log changes. Returns an unsubscribe function. */
export function onMusicLog(fn: () => void): () => void {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

const truncate = (s: string, n = 300): string =>
  s.length > n ? `${s.slice(0, n)}…` : s;

/** Human-readable text for anything thrown. The Tauri HTTP plugin rejects
 * with plain strings and gateways with JSON objects — none of that may be
 * flattened into a generic "failed". */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string" && e.trim()) return e;
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}" && s !== "null") return s;
  } catch {
    // fall through
  }
  return String(e);
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

/** Generate any missing workout tracks. Safe to call often — no-ops when
 * already running, when no API key is set, or when everything is cached
 * with nothing in flight.
 *
 * Two phases. Phase 1 submits a request per missing track — quick, and
 * from then on the tracks compose on the gateway's servers whether or not
 * the phone stays awake. Phase 2 polls for results and downloads them.
 * If Android freezes the WebView (standby) at any point, the persisted
 * taskIds let the next foreground pass resume instead of fail.
 *
 * A track that fails on the server is re-requested once; if the first two
 * submissions fail and nothing has ever succeeded, the run bails early
 * (broken key/credits) instead of burning a request per workout. Every
 * failure is surfaced through EnsureStatus.error and the composer log —
 * never silently. */
export async function ensureAllTracks(): Promise<void> {
  if (ensureRunning) return;
  const settings = loadMusicSettings();
  if (!settings.apiKey) return;

  ensureRunning = true;
  let failed = 0;
  let firstError: string | undefined;
  try {
    const workouts = workoutMusicList();
    const total = workouts.length;

    // Adopt in-flight tasks from a previous run (standby, restart), and
    // drop records that are stale (already cached, or workout gone).
    for (const t of loadPendingTasks()) {
      if (
        !workouts.some((w) => w.key === t.key) ||
        (await getCachedTrack(t.key))
      ) {
        removePendingTask(t.key);
      }
    }
    const resumed = loadPendingTasks().length;
    if (resumed > 0) {
      musicLog(
        `Resuming ${resumed} in-flight request${resumed === 1 ? "" : "s"} from a previous run.`,
      );
    }

    let ready = 0;
    const missing: WorkoutMusic[] = [];
    for (const w of workouts) {
      if (await getCachedTrack(w.key)) ready++;
      else if (!loadPendingTasks().some((t) => t.key === w.key)) missing.push(w);
    }
    if (missing.length === 0 && loadPendingTasks().length === 0) return;

    // Phase 1 — submit a request for every missing track. A failing
    // submission is retried once.
    const anySucceededBefore = ready > 0;
    let submitted = 0;
    let submitFailed = 0;
    for (const w of missing) {
      emit({
        running: true,
        ready,
        total,
        pending: loadPendingTasks().length,
        current: w.name,
        error: firstError,
      });
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        try {
          await requestTrack(w.key, w.name, w.profile, settings);
          ok = true;
          submitted++;
        } catch (e) {
          musicLog(
            `Request for "${w.name}" failed (attempt ${attempt}/2): ${errorText(e)}`,
          );
          if (attempt === 2) {
            submitFailed++;
            failed++;
            firstError ??= `${w.name}: ${errorText(e)}`;
          }
        }
      }
      // Two workouts failed both attempts and nothing has ever succeeded:
      // the key/gateway is almost certainly broken — stop wasting requests.
      if (submitFailed >= 2 && submitted === 0 && !anySucceededBefore) {
        musicLog(
          "Two submissions failed and nothing has ever succeeded — stopping early (broken key or gateway?).",
        );
        break;
      }
    }

    // Phase 2 — poll everything in flight until finished or failed.
    // Standby freezes this loop harmlessly: the tracks keep composing
    // server-side and the loop continues on the next resume.
    const retriedKeys = new Set<string>();
    let unreachableRounds = 0;
    while (loadPendingTasks().length > 0) {
      emit({
        running: true,
        ready,
        total,
        pending: loadPendingTasks().length,
        error: firstError,
      });
      await sleep(POLL_INTERVAL_MS);
      let reachedGateway = false;
      for (const task of loadPendingTasks()) {
        let result: PollResult;
        try {
          result = await pollPendingTask(task, settings);
        } catch (e) {
          // Terminal failure — pollPendingTask already dropped the record.
          reachedGateway = true;
          const w = workouts.find((x) => x.key === task.key);
          if (w && !retriedKeys.has(task.key)) {
            retriedKeys.add(task.key);
            musicLog(
              `"${task.workoutName}" failed — submitting one fresh request.`,
            );
            try {
              await requestTrack(w.key, w.name, w.profile, settings);
              continue;
            } catch (e2) {
              musicLog(
                `Fresh request for "${w.name}" failed too: ${errorText(e2)}`,
              );
            }
          }
          failed++;
          firstError ??= `${task.workoutName}: ${errorText(e)}`;
          continue;
        }
        if (result === "unreachable") continue;
        reachedGateway = true;
        if (result === "pending") {
          // Only a gateway-confirmed "still pending" can expire — a long
          // standby can never time out a track that actually finished.
          if (Date.now() - Date.parse(task.requestedAt) > PENDING_TTL_MS) {
            removePendingTask(task.key);
            failed++;
            firstError ??= `${task.workoutName}: gave up after 30 minutes.`;
            musicLog(
              `"${task.workoutName}" still pending after 30 minutes — giving up on taskId ${task.taskId}.`,
            );
          }
        } else {
          ready++;
        }
      }
      unreachableRounds = reachedGateway ? 0 : unreachableRounds + 1;
      if (
        loadPendingTasks().length > 0 &&
        unreachableRounds >= MAX_UNREACHABLE_ROUNDS
      ) {
        firstError ??=
          "Gateway unreachable — in-flight tracks keep composing on the server and are picked up next time the app is open.";
        musicLog(
          "Gateway unreachable for ~2 minutes — pausing. In-flight tracks resume next time the app is in the foreground.",
        );
        break;
      }
    }
  } finally {
    ensureRunning = false;
    const list = workoutMusicList();
    let readyNow = 0;
    for (const w of list) {
      if (await getCachedTrack(w.key)) readyNow++;
    }
    const pendingLeft = loadPendingTasks().length;
    emit({
      running: false,
      ready: readyNow,
      total: list.length,
      pending: pendingLeft > 0 ? pendingLeft : undefined,
      error:
        failed > 0
          ? `${failed} track${failed === 1 ? "" : "s"} failed — ${firstError ?? ""}`
          : firstError,
    });
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

/* ------------------------------ HTTP layer ------------------------------- */
// Inside the Tauri app, webview fetch is subject to CORS and gateways
// don't reliably send CORS headers (especially on error responses),
// which surfaces as an opaque "Failed to fetch". The Tauri HTTP plugin
// performs the request natively and is immune to CORS; plain fetch is
// the fallback for browser dev.

async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return await tauriFetch(url, init);
    }
    return await fetch(url, init);
  } catch (e) {
    // The Tauri plugin rejects with plain strings — wrap everything so the
    // real reason survives instead of collapsing into a generic "failed".
    throw new Error(`${init?.method ?? "GET"} ${url} — ${errorText(e)}`);
  }
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

function authHeaders(settings: MusicSettings): Record<string, string> {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Submit a generation request. Returns as soon as the gateway accepts the
 * task and the pending record is persisted — from then on the track
 * composes server-side and the phone is free to sleep.
 */
async function requestTrack(
  key: string,
  workoutName: string,
  profile: MusicProfile,
  settings: MusicSettings,
): Promise<PendingTask> {
  const base = settings.baseUrl.replace(/\/+$/, "");
  const prompt =
    `Instrumental workout track for "${workoutName}". ${profile.theme}. ` +
    `Style: ${profile.style}. Steady ${profile.bpm} BPM, driving rhythm, ` +
    `high energy, no vocals.`;

  musicLog(`Requesting "${workoutName}" (model ${settings.model}) from ${base}…`);
  const createRes = await httpFetch(`${base}/api/v1/generate`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({
      customMode: false,
      instrumental: true,
      model: settings.model,
      prompt,
      // The gateway requires a callback URL even though we poll for the
      // result; example.com is IANA-reserved and discards the POST.
      callBackUrl: "https://example.com/varg-suno-callback",
    }),
  });
  const rawBody = await createRes.text().catch(() => "");
  let created: GatewayResponse<{ taskId?: string }> | null = null;
  try {
    created = JSON.parse(rawBody) as GatewayResponse<{ taskId?: string }>;
  } catch {
    // non-JSON body — logged below
  }
  const taskId =
    createRes.ok && created?.code === 200 ? created.data?.taskId : undefined;
  if (taskId == null) {
    musicLog(
      `Request for "${workoutName}" rejected — HTTP ${createRes.status}, body: ${truncate(rawBody) || "(empty)"}`,
    );
    const msg = created?.msg;
    throw new Error(
      msg?.trim()
        ? msg
        : `Generation request failed (HTTP ${createRes.status}${
            rawBody ? `: ${truncate(rawBody, 120)}` : ""
          }).`,
    );
  }
  musicLog(`"${workoutName}" accepted — taskId ${taskId}. Composing on the server.`);
  const task: PendingTask = {
    key,
    workoutName,
    taskId,
    requestedAt: new Date().toISOString(),
  };
  addPendingTask(task);
  return task;
}

type PollResult = "pending" | "unreachable" | CachedTrack;

/**
 * One poll of an in-flight task. Downloads and caches the track on success
 * (removing the pending record), throws on a terminal gateway failure (also
 * removing it), returns "pending" while composing and "unreachable" on any
 * network error — transient by definition, since the track keeps composing
 * server-side regardless.
 */
async function pollPendingTask(
  task: PendingTask,
  settings: MusicSettings,
): Promise<PollResult> {
  const base = settings.baseUrl.replace(/\/+$/, "");
  let pollRes: Response;
  let rawBody = "";
  try {
    pollRes = await httpFetch(
      `${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(task.taskId)}`,
      { headers: authHeaders(settings) },
    );
    rawBody = await pollRes.text().catch(() => "");
  } catch (e) {
    musicLog(
      `Poll for "${task.workoutName}" didn't reach the gateway: ${errorText(e)}`,
    );
    return "unreachable";
  }
  let poll: GatewayResponse<RecordInfo> | null = null;
  try {
    poll = JSON.parse(rawBody) as GatewayResponse<RecordInfo>;
  } catch {
    // non-JSON body — logged below
  }
  if (!pollRes.ok || poll == null) {
    musicLog(
      `Poll for "${task.workoutName}" — HTTP ${pollRes.status}, body: ${truncate(rawBody) || "(empty)"}`,
    );
    return "pending"; // odd gateway reply; bounded by the 30-minute TTL
  }
  const status = poll.data?.status ?? "PENDING";
  const song = poll.data?.response?.sunoData?.[0];

  // A failed callback delivery (we don't host one) can surface as
  // CALLBACK_EXCEPTION even though the track itself is done — so treat
  // any terminal status with an audio URL as success.
  if (status === "SUCCESS" || (status === "CALLBACK_EXCEPTION" && song?.audioUrl)) {
    if (!song?.audioUrl) {
      removePendingTask(task.key);
      musicLog(
        `"${task.workoutName}" finished but no audio URL — body: ${truncate(rawBody)}`,
      );
      throw new Error("Track finished but the gateway returned no audio URL.");
    }
    musicLog(`"${task.workoutName}" is ready — downloading…`);
    let audio: Response;
    try {
      audio = await httpFetch(song.audioUrl);
    } catch (e) {
      musicLog(
        `Download of "${task.workoutName}" failed (will retry): ${errorText(e)}`,
      );
      return "unreachable";
    }
    if (!audio.ok) {
      removePendingTask(task.key);
      musicLog(
        `Download of "${task.workoutName}" rejected — HTTP ${audio.status}.`,
      );
      throw new Error(
        `Could not download the finished track (HTTP ${audio.status}).`,
      );
    }
    const blob = await audio.blob();
    const track: CachedTrack = {
      key: task.key,
      title: song.title?.trim() ? song.title : task.workoutName,
      blob,
      createdAt: new Date().toISOString(),
    };
    await putCachedTrack(track);
    removePendingTask(task.key);
    musicLog(
      `"${task.workoutName}" cached (${Math.round(blob.size / 1024)} kB) — done.`,
    );
    return track;
  }
  if (
    status.endsWith("FAILED") ||
    status === "CALLBACK_EXCEPTION" ||
    status === "SENSITIVE_WORD_ERROR"
  ) {
    removePendingTask(task.key);
    musicLog(
      `"${task.workoutName}" failed on the server — status ${status}, body: ${truncate(rawBody)}`,
    );
    throw new Error(`Generation failed (${status}).`);
  }
  return "pending";
}

/**
 * Generate a track for one workout and wait for it: submit, then poll until
 * it's cached. Resolves with the cached track; throws with a human-readable
 * message. Standby-safe: the request is persisted, so even if this call
 * never returns (app killed mid-wait), the background composer picks the
 * finished track up on the next launch.
 */
export async function generateTrack(
  key: string,
  workoutName: string,
  profile: MusicProfile,
  settings: MusicSettings,
  onStatus: (status: string) => void,
): Promise<CachedTrack> {
  onStatus("Requesting track…");
  removePendingTask(key); // a regenerate abandons any stale in-flight task
  const task = await requestTrack(key, workoutName, profile, settings);
  onStatus(
    "Composing on Suno's servers — usually 1–3 minutes. Locking your phone is fine; the track is picked up when you come back.",
  );
  let unreachable = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    // The background composer may have resolved this task in the meantime.
    if (!loadPendingTasks().some((t) => t.taskId === task.taskId)) {
      const cached = await getCachedTrack(key);
      if (cached) return cached;
      throw new Error("Generation failed — see the composer log in Settings.");
    }
    const result = await pollPendingTask(task, settings);
    if (result === "unreachable") {
      unreachable++;
      if (unreachable >= MAX_UNREACHABLE_ROUNDS) {
        // Keep the pending record: if the track does finish server-side,
        // the background composer downloads it on the next foreground pass.
        throw new Error(
          "Can't reach the gateway. If the track finishes anyway, it's picked up automatically next time the app is open.",
        );
      }
      continue;
    }
    unreachable = 0;
    if (result === "pending") {
      if (Date.now() - Date.parse(task.requestedAt) > PENDING_TTL_MS) {
        removePendingTask(key);
        throw new Error("Timed out waiting for the track — try again later.");
      }
      continue;
    }
    return result;
  }
}
