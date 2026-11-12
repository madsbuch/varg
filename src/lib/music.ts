// Workout music via Suno, generated to match each workout's bpm/style/theme.
//
// Suno has no official public API, so this goes through kie.ai with the
// owner's own key — the same key that generates the spoken yoga cues
// (src/lib/kie.ts, src/lib/voice-clips.ts).
//
// Every finished track is downloaded and cached in IndexedDB keyed by
// workout, so a track is generated exactly once per workout.
//
// Generation is standby-safe: requests are submitted first (composing then
// happens on kie.ai's servers, phone asleep or not), in-flight taskIds
// are persisted, and results are polled — resumed on every app foreground.

import type { Intensity, IntervalPlan, MusicProfile } from "../types";
import { seedTemplates } from "./seed";
import { formatSeconds } from "./units";
import { errorText, httpFetch } from "./http";
import { KieError, audioResults, createTask, download, getTask } from "./kie";

export { errorText, httpFetch };

export const DEFAULT_MODEL = "V6";
/**
 * kie.ai's current Suno models. Everything older (V4 … V5_5) is deprecated
 * and, crucially, cannot take a `duration` — those models pick their own
 * length, which in practice was ~2 minutes against 18-minute workouts.
 */
export const SUNO_MODELS = ["V6", "V6_WILD", "V6_MINI"];
const SETTINGS_KEY = "varg.music.v1";
const PROFILES_KEY = "varg.music.profiles.v1";

export interface MusicSettings {
  /** The kie.ai API key — shared by music and voice. */
  apiKey: string;
  model: string;
}

export function loadMusicSettings(): MusicSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MusicSettings>;
      return {
        apiKey: p.apiKey ?? "",
        // A model saved before V6 is deprecated and can't be given a
        // duration, so it moves to the default rather than lingering as an
        // option the picker no longer lists.
        model:
          p.model && SUNO_MODELS.includes(p.model) ? p.model : DEFAULT_MODEL,
      };
    }
  } catch {
    // fall through to defaults
  }
  return { apiKey: "", model: DEFAULT_MODEL };
}

export function saveMusicSettings(s: MusicSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ apiKey: s.apiKey, model: s.model }));
}

/** Profile for sessions that weren't started from a template. */
export const FREESTYLE_PROFILE: MusicProfile = {
  bpm: 150,
  style: "dark electronic rock, heavy driving drums",
  theme: "Wolf on the hunt: raw, relentless training energy",
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
    ...seedTemplates().flatMap((t) =>
      isAdaptive(t)
        ? LAYERS.map((l) => ({ key: layerKey(t.id, l), name: `${t.name} · ${LAYER_NAMES[l]}`, music: t.music }))
        : [{ key: t.id, name: t.name, music: t.music }],
    ),
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
// Standby-safe by design: composing happens on kie.ai's servers, not
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
// A generation request is fire-and-forget for kie.ai: once submitted,
// it composes server-side whether or not the phone stays awake. Pending
// taskIds live in localStorage so an interrupted run is resumed, not failed.

const PENDING_KEY = "varg.music.pending.v1";
const POLL_INTERVAL_MS = 10_000;
// A task kie.ai *confirms* is still pending after this long is dead.
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

/* ---------------------------- Failed tracks ------------------------------ */
// A workout whose generation terminally fails is never cached, so it used to
// re-enter `missing` on every single app foreground — two charged submissions
// each time, forever, for a track that can never succeed (moderation
// rejection, revoked key). Failures are therefore persisted: past the attempt
// ceiling a key is only re-submitted once its backoff has elapsed, or when
// the user explicitly asks for it from Settings.

const FAILED_KEY = "varg.music.failed.v1";
export const MAX_FAILED_ATTEMPTS = 3;
// Wait before the composer spends another generation, indexed by how far the
// attempt count is past the ceiling.
const FAILED_BACKOFF_MS = [
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

export interface TrackFailure {
  attempts: number;
  lastAt: string; // ISO
  reason: string;
}

export function loadTrackFailures(): Record<string, TrackFailure> {
  try {
    const raw = localStorage.getItem(FAILED_KEY);
    if (raw) return JSON.parse(raw) as Record<string, TrackFailure>;
  } catch {
    // fall through
  }
  return {};
}

function saveTrackFailures(all: Record<string, TrackFailure>): void {
  localStorage.setItem(FAILED_KEY, JSON.stringify(all));
}

/** Record one terminal failure for a workout, bumping its attempt count. */
function recordTrackFailure(key: string, reason: string): void {
  const all = loadTrackFailures();
  all[key] = {
    attempts: (all[key]?.attempts ?? 0) + 1,
    lastAt: new Date().toISOString(),
    reason: truncate(reason, 160),
  };
  saveTrackFailures(all);
}

/** Forget a workout's failure history — on success, or when the user
 * explicitly retries it. */
export function clearTrackFailure(key: string): void {
  const all = loadTrackFailures();
  if (key in all) {
    saveTrackFailures(
      Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)),
    );
  }
}

/** May the composer spend a generation on this key right now? */
function mayAttempt(
  key: string,
  failures: Record<string, TrackFailure> = loadTrackFailures(),
): boolean {
  const f = failures[key];
  if (!f || f.attempts < MAX_FAILED_ATTEMPTS) return true;
  const i = Math.min(
    f.attempts - MAX_FAILED_ATTEMPTS,
    FAILED_BACKOFF_MS.length - 1,
  );
  return Date.now() - Date.parse(f.lastAt) >= (FAILED_BACKOFF_MS[i] ?? 0);
}

/** kie.ai rejected the API key. That applies to every request in
 * flight, not just one task, so a run must stop rather than retry per
 * workout. */
class MusicAuthError extends Error {}

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
 * from then on the tracks compose on kie.ai's servers whether or not
 * the phone stays awake. Phase 2 polls for results and downloads them.
 * If Android freezes the WebView (standby) at any point, the persisted
 * taskIds let the next foreground pass resume instead of fail.
 *
 * A track that fails on the server is re-requested once; if the first two
 * submissions fail and nothing has ever succeeded, the run bails early
 * (broken key/credits) instead of burning a request per workout. Failures
 * are persisted per workout, so a track that can never succeed stops costing
 * a generation on every foreground once it hits the attempt ceiling, and a
 * rejected API key stops the whole run rather than one task. Every failure
 * is surfaced through EnsureStatus.error and the composer log — never
 * silently. */
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
    let blocked = 0;
    const failures = loadTrackFailures();
    const missing: WorkoutMusic[] = [];
    for (const w of workouts) {
      if (await getCachedTrack(w.key)) {
        ready++;
      } else if (!loadPendingTasks().some((t) => t.key === w.key)) {
        if (mayAttempt(w.key, failures)) missing.push(w);
        else blocked++;
      }
    }
    if (missing.length === 0 && loadPendingTasks().length === 0) return;
    // Logged only when the run has work to do — otherwise every foreground
    // would push a line into the ring buffer and bury the real diagnostics.
    if (blocked > 0) {
      musicLog(
        `${blocked} workout${blocked === 1 ? "" : "s"} skipped: generation has failed ${String(MAX_FAILED_ATTEMPTS)}+ times; retry from Settings.`,
      );
    }

    // Phase 1 — submit a request for every missing track. A failing
    // submission is retried once.
    const anySucceededBefore = ready > 0;
    let submitted = 0;
    let submitFailed = 0;
    for (const w of missing) {
      // Re-checked per iteration, not just in the snapshot above: submitting
      // takes many seconds, and a manual regenerate started meanwhile has
      // already put this key in flight. Submitting again charges a second
      // credit and orphans one of the two tasks.
      if (loadPendingTasks().some((t) => t.key === w.key)) continue;
      if (await getCachedTrack(w.key)) {
        ready++;
        continue;
      }
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
            recordTrackFailure(w.key, errorText(e));
            firstError ??= `${w.name}: ${errorText(e)}`;
          }
        }
      }
      // Two workouts failed both attempts and nothing has ever succeeded:
      // the key or account is almost certainly broken — stop wasting requests.
      if (submitFailed >= 2 && submitted === 0 && !anySucceededBefore) {
        musicLog(
          "Two submissions failed and nothing has ever succeeded. Stopping early (broken key or kie.ai account?).",
        );
        break;
      }
    }

    // Phase 2 — poll everything in flight until finished or failed.
    // Standby freezes this loop harmlessly: the tracks keep composing
    // server-side and the loop continues on the next resume.
    const retriedKeys = new Set<string>();
    let unreachableRounds = 0;
    let authFailed = false;
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
          // Terminal failure — pollPendingTask already dropped the record
          // and counted the attempt.
          reachedGateway = true;
          if (e instanceof MusicAuthError) {
            // The key is bad, not this one task: every request in flight is
            // doomed, so resubmitting any of them only burns credits.
            authFailed = true;
            failed++;
            firstError ??= errorText(e);
            musicLog(
              "kie.ai rejected the API key. Stopping this run. Check the key in Settings.",
            );
            break;
          }
          const w = workouts.find((x) => x.key === task.key);
          if (w && !retriedKeys.has(task.key) && mayAttempt(task.key)) {
            retriedKeys.add(task.key);
            musicLog(
              `"${task.workoutName}" failed. Submitting one fresh request.`,
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
          // Only a kie.ai-confirmed "still pending" can expire — a long
          // standby can never time out a track that actually finished.
          if (Date.now() - Date.parse(task.requestedAt) > PENDING_TTL_MS) {
            removePendingTask(task.key);
            recordTrackFailure(task.key, "Still pending after 30 minutes.");
            failed++;
            firstError ??= `${task.workoutName}: gave up after 30 minutes.`;
            musicLog(
              `"${task.workoutName}" still pending after 30 minutes. Giving up on taskId ${task.taskId}.`,
            );
          }
        } else {
          ready++;
        }
      }
      if (authFailed) break;
      unreachableRounds = reachedGateway ? 0 : unreachableRounds + 1;
      if (
        loadPendingTasks().length > 0 &&
        unreachableRounds >= MAX_UNREACHABLE_ROUNDS
      ) {
        firstError ??=
          "Gateway unreachable. In-flight tracks keep composing on the server and are picked up next time the app is open.";
        musicLog(
          "Gateway unreachable for ~2 minutes, pausing. In-flight tracks resume next time the app is in the foreground.",
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
          ? `${failed} track${failed === 1 ? "" : "s"} failed: ${firstError ?? ""}`
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


/* ------------------------------ Suno via kie.ai ------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Limit on `style` for the V6 models. */
export const STYLE_LIMIT = 1000;
/** Limit on `title`, all models. */
const TITLE_LIMIT = 80;
/**
 * Requested track length: Suno's maximum through kie.ai. The workouts run longer
 * than this, so the track still loops with a crossfaded seam
 * (src/lib/track.ts) — just far less often than a 2-minute track did.
 */
export const TRACK_SECONDS = 360;

/**
 * The workout's work/rest rhythm, phrased for the model. This shapes the
 * arrangement's feel — surges and breathers of roughly the right length —
 * but it is NOT a sync: Suno's timing is approximate, the track loops, and
 * playback is not aligned to the workout clock. Untimed workouts (logged
 * sessions) get nothing.
 */
/* ---------------------------- Adaptive layers ---------------------------- */
// An adaptive ride has no single track. It has one per intensity, composed
// in the same style, tempo and key, and the ride player mixes between them
// block by block (src/lib/mixer.ts). Each layer is cached and composed like
// any workout track, under its own key.

/** True when a ride drives its music's intensity block by block. */
export function isAdaptive(tpl: { ride?: { segments: { intensity?: unknown }[] } | undefined }): boolean {
  return tpl.ride?.segments.some((s) => s.intensity !== undefined) ?? false;
}

export const LAYERS: readonly Intensity[] = [1, 2, 3];
export const LAYER_NAMES: Record<Intensity, string> = { 1: "Low", 2: "Mid", 3: "Peak" };

/** Cache key of one layer of an adaptive ride. */
export function layerKey(templateId: string, level: Intensity): string {
  return `${templateId}#${String(level)}`;
}

function parseLayerKey(key: string): { templateId: string; level?: Intensity } {
  const [templateId = key, l] = key.split("#");
  const n = Number(l);
  return n === 1 || n === 2 || n === 3 ? { templateId, level: n } : { templateId };
}

/**
 * Layers are loops, not songs: the mixer cuts up to 32 bars from each, so
 * two minutes is plenty and keeps three decoded layers small on the phone.
 */
export const LAYER_SECONDS = 120;

const LAYER_ENERGY: Record<Intensity, string> = {
  1: "Energy: low. Stripped back: kick, bass and soft hats only, no lead, no risers.",
  2: "Energy: medium. Full groove: kick, rolling bass, claps, rhythmic synth stabs.",
  3: "Energy: maximum. Peak drop: pounding kick, heavy bass, big lead synth, everything in.",
};

/**
 * The style for one layer. What the mixer needs comes first and is never
 * trimmed: one steady tempo, a kick on every beat (the beat grid is found
 * from it), one key so layers can cross, and no intro, breakdown or fade.
 */
export function buildLayerStyle(profile: MusicProfile, level: Intensity): string {
  const head =
    `Instrumental electronic workout loop, constant ${String(profile.bpm)} BPM, strict 4/4, ` +
    `four-on-the-floor kick on every beat, A minor, no vocals. Starts on the first beat ` +
    `with no intro; no breakdowns, no tempo changes, no fade-out. ${LAYER_ENERGY[level]}`;
  const full = `${head} Style: ${profile.style}.`;
  return full.length <= STYLE_LIMIT ? full : full.slice(0, STYLE_LIMIT - 1).trimEnd() + "…";
}

function timingLine(interval?: IntervalPlan): string {
  if (!interval) return "";
  const cycle = interval.work + interval.rest;
  return (
    ` Phrase it in repeating ${cycle} s cycles: ${interval.work} s full ` +
    `drive, ${interval.rest} s stripped back.`
  );
}

/**
 * The track description, sent as `style`. Generation runs in custom mode
 * because that is the only mode that accepts `duration` — and in custom
 * mode `prompt` is sung as lyrics, so the description must NOT go there.
 *
 * Built to fit STYLE_LIMIT rather than be sent and refused; a user-edited
 * theme or style that runs long is what gets trimmed, never the tempo or
 * the arrangement instructions that lead.
 */
export function buildStyle(
  workoutName: string,
  profile: MusicProfile,
  interval?: IntervalPlan,
): string {
  const head =
    `Instrumental workout mix, steady ${profile.bpm} BPM, no vocals. ` +
    `Long DJ arrangement, many evolving sections, no early ending or ` +
    `fade-out.` +
    timingLine(interval);
  const tail =
    ` For "${workoutName}": ${profile.theme}. Style: ${profile.style}.`;
  const full = head + tail;
  if (full.length <= STYLE_LIMIT) return full;
  return full.slice(0, STYLE_LIMIT - 1).trimEnd() + "…";
}

/**
 * Submit a generation request. Returns as soon as kie.ai accepts the task
 * and the pending record is persisted — from then on the track composes
 * server-side and the phone is free to sleep.
 */
async function requestTrack(
  key: string,
  workoutName: string,
  profile: MusicProfile,
  settings: MusicSettings,
): Promise<PendingTask> {
  const { templateId, level } = parseLayerKey(key);
  const tpl = seedTemplates().find((t) => t.id === templateId);
  const style = level
    ? buildLayerStyle(profile, level)
    : buildStyle(workoutName, profile, tpl?.interval);

  musicLog(`Requesting "${workoutName}" (Suno ${settings.model}) from kie.ai…`);
  let taskId: string;
  try {
    taskId = await createTask(settings.apiKey, "ai-music-api/generate", {
      // Custom mode: the only mode that takes `duration`. No `prompt` —
      // here it would be sung as lyrics.
      custom_mode: true,
      instrumental: true,
      model: settings.model,
      title: workoutName.slice(0, TITLE_LIMIT),
      style,
      negative_tags: "vocals, singing, rap, spoken word, choir",
      // Always sent: without it the model picks its own, short, length.
      duration: level ? LAYER_SECONDS : TRACK_SECONDS,
    });
  } catch (e) {
    musicLog(`Request for "${workoutName}" rejected: ${errorText(e)}`);
    if (e instanceof KieError && e.isAuth) throw new MusicAuthError(e.message);
    throw e;
  }
  musicLog(`"${workoutName}" accepted: taskId ${taskId}. Composing on the server.`);
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
 * (removing the pending record), throws on a terminal failure (also removing
 * it), returns "pending" while composing and "unreachable" on any network
 * error — transient by definition, since the track keeps composing
 * server-side regardless.
 */
async function pollPendingTask(
  task: PendingTask,
  settings: MusicSettings,
): Promise<PollResult> {
  let info;
  try {
    info = await getTask(settings.apiKey, task.taskId);
  } catch (e) {
    if (!(e instanceof KieError)) {
      musicLog(`Poll for "${task.workoutName}" didn't reach kie.ai: ${errorText(e)}`);
      return "unreachable";
    }
    if (e.code === 429 || e.code >= 500) {
      musicLog(`Poll for "${task.workoutName}": ${e.message} (will retry)`);
      return "pending";
    }
    // A 4xx is about the request, not the composition: reading it as "still
    // composing" bought 30 minutes of doomed polling behind a UI that said
    // everything was fine. A refused key kills the whole run.
    removePendingTask(task.key);
    recordTrackFailure(task.key, e.message);
    musicLog(`Poll for "${task.workoutName}" rejected: ${e.message}`);
    if (e.isAuth) throw new MusicAuthError(e.message);
    throw e;
  }

  if (info.state === "fail") {
    removePendingTask(task.key);
    const why = info.failMsg.trim() ? info.failMsg : "no reason given";
    recordTrackFailure(task.key, `Generation failed on the server: ${why}`);
    musicLog(`"${task.workoutName}" failed on the server: ${why}`);
    throw new Error(`Generation failed: ${why}`);
  }
  if (info.state !== "success") return "pending";

  // Each request returns two variations, and the requested duration is a
  // target, not a promise — a live V6 run asking for 360 s came back as
  // 4:52 and 5:59, shorter first. Keep the longest: the whole point of
  // asking for length is fewer loop seams.
  const songs = audioResults(info.result);
  const song = songs.reduce<(typeof songs)[number] | undefined>(
    (best, x) => (!best || (x.duration ?? 0) > (best.duration ?? 0) ? x : best),
    undefined,
  );
  if (!song) {
    removePendingTask(task.key);
    recordTrackFailure(task.key, "Finished with no audio URL.");
    musicLog(`"${task.workoutName}" finished but no audio URL. Result: ${truncate(JSON.stringify(info.result))}`);
    throw new Error("Track finished but kie.ai returned no audio URL.");
  }
  musicLog(`"${task.workoutName}" is ready, downloading…`);
  let blob: Blob;
  try {
    blob = await download(song.url);
  } catch (e) {
    musicLog(`Download of "${task.workoutName}" failed (will retry): ${errorText(e)}`);
    return "unreachable";
  }
  const track: CachedTrack = {
    key: task.key,
    title: song.title?.trim() ? song.title : task.workoutName,
    blob,
    createdAt: new Date().toISOString(),
  };
  await putCachedTrack(track);
  removePendingTask(task.key);
  clearTrackFailure(task.key);
  const length =
    song.duration != null
      ? `${formatSeconds(song.duration)}, `
      : "";
  musicLog(
    `"${task.workoutName}" cached (${length}${Math.round(blob.size / 1024)} kB), done.`,
  );
  return track;
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
  // An explicit regenerate is the user overruling the backoff, so the
  // failure history goes with the stale in-flight task.
  removePendingTask(key);
  clearTrackFailure(key);
  await requestTrack(key, workoutName, profile, settings);
  onStatus(
    "Composing on Suno's servers, usually 1–3 minutes. Locking your phone is fine; the track is picked up when you come back.",
  );
  let unreachable = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    // Re-resolved by key, never by taskId: the background composer may have
    // replaced our record with its own request for the same workout. That is
    // still this workout being composed, so following the current record is
    // right — matching on our taskId reported a false "Generation failed"
    // while a paid task carried on unwatched.
    const mine = loadPendingTasks().find((t) => t.key === key);
    if (!mine) {
      // Nothing in flight: either it landed in the cache or it died.
      const cached = await getCachedTrack(key);
      if (cached) return cached;
      throw new Error("Generation failed. See the composer log in Settings.");
    }
    const result = await pollPendingTask(mine, settings);
    if (result === "unreachable") {
      unreachable++;
      if (unreachable >= MAX_UNREACHABLE_ROUNDS) {
        // Keep the pending record: if the track does finish server-side,
        // the background composer downloads it on the next foreground pass.
        throw new Error(
          "Can't reach kie.ai. If the track finishes anyway, it's picked up automatically next time the app is open.",
        );
      }
      continue;
    }
    unreachable = 0;
    if (result === "pending") {
      if (Date.now() - Date.parse(mine.requestedAt) > PENDING_TTL_MS) {
        removePendingTask(key);
        recordTrackFailure(key, "Still pending after 30 minutes.");
        throw new Error("Timed out waiting for the track. Try again later.");
      }
      continue;
    }
    return result;
  }
}
