/**
 * Garmin Connect, through the Personal API: read-only, personal use, no
 * server. The owner creates a key in Garmin Connect (Settings → Personal
 * API Key); Varg trades it for a 24-hour bearer token and pulls:
 *
 * - FTP, from the newest ride that carries one (it is not in the profile),
 * - the watch's activities, for the Saga and for heart rate on Varg
 *   sessions (matched by overlapping time, never by start time: the watch
 *   and Varg are started independently),
 * - last night's readiness for the Den: sleep, HRV, Body Battery, resting HR.
 *
 * Everything fetched is cached on the device, so the Den and the Saga
 * render offline. It is derived data and can always be fetched again,
 * which is why it lives in localStorage and not in the training database.
 *
 * Failures are kept and shown (Skipan in red, the Den card), never
 * swallowed: a sync that quietly stopped looks exactly like a quiet week.
 *
 * Spec: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
 */
import { useSyncExternalStore } from "react";
import { errorText, httpFetch } from "./http";
import { loadFtp, saveFtp } from "./ride";
import type { Session } from "../types";

const BASE = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

const KEY_KEY = "varg.garmin.key";
const TOKEN_KEY = "varg.garmin.token";
const STATE_KEY = "varg.garmin.state.v1";

/** Re-sync on open or return at most this often; Sync now ignores it. */
const SYNC_EVERY_MS = 15 * 60 * 1000;
/** First sync reaches this far back; later ones overlap the last by a few days. */
const FIRST_SYNC_DAYS = 365;
const RESYNC_OVERLAP_DAYS = 3;
const PAGE = 99;
const MAX_PAGES = 20;

// --- What Varg keeps ---------------------------------------------------------

/** One watch activity, trimmed to what Varg shows. Times in ms UTC, durations in s. */
export interface GarminActivity {
  id: number;
  name: string;
  /** Garmin's type key: "running", "indoor_cycling", "strength_training"… */
  type: string;
  start: number;
  /** Elapsed, pauses included: the window the watch was running. */
  seconds: number;
  meters?: number | undefined;
  kcal?: number | undefined;
  avgHr?: number | undefined;
  maxHr?: number | undefined;
  avgPower?: number | undefined;
  normPower?: number | undefined;
  /** Seconds in heart-rate zones 1-5. */
  hrZones?: number[] | undefined;
}

export interface GarminFtp {
  watts: number;
  activityId: number;
  activityName: string;
  /** When that ride started, ms UTC. */
  rideStart: number;
}

export interface GarminReadiness {
  /** The local calendar date it describes, yyyy-MM-dd. */
  date: string;
  sleepSeconds?: number | undefined;
  sleepScore?: number | undefined;
  hrvLastNight?: number | undefined;
  hrvWeekly?: number | undefined;
  /** BALANCED, UNBALANCED, LOW, POOR… */
  hrvStatus?: string | undefined;
  bodyBatteryAtWake?: number | undefined;
  bodyBatteryNow?: number | undefined;
  restingHr?: number | undefined;
  /** Parts that failed, with why. The rest still shows. */
  errors: string[];
}

export interface GarminState {
  activities: GarminActivity[];
  ftp?: GarminFtp | undefined;
  /** Why the last FTP lookup did not produce one. */
  ftpError?: string | undefined;
  readiness?: GarminReadiness | undefined;
  /** Last sync that completed, ISO. */
  lastSync?: string | undefined;
  /** Last attempt, ISO, successful or not. */
  lastAttempt?: string | undefined;
  /** Set when the last sync failed outright; cleared by the next success. */
  error?: string | undefined;
  /** Take FTP from Garmin. On by default; off keeps the FTP typed in Skipan. */
  followFtp: boolean;
  syncing: boolean;
}

const EMPTY: GarminState = { activities: [], followFtp: true, syncing: false };

function readState(): GarminState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<GarminState>;
    return { ...EMPTY, ...parsed, activities: parsed.activities ?? [], syncing: false };
  } catch {
    return EMPTY;
  }
}

let state: GarminState = typeof localStorage === "undefined" ? EMPTY : readState();
const listeners = new Set<() => void>();

function setState(patch: Partial<GarminState>): void {
  state = { ...state, ...patch };
  try {
    // `syncing` describes this run only; readState resets it anyway.
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, syncing: false }));
  } catch {
    // Storage full or blocked: the state still holds for this run.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useGarmin(): GarminState {
  return useSyncExternalStore(subscribe, () => state);
}

export function setFollowFtp(on: boolean): void {
  setState({ followFtp: on });
  if (on && state.ftp) saveFtp(state.ftp.watts);
}

// --- The key -------------------------------------------------------------------

export function loadGarminKey(): string {
  try {
    return localStorage.getItem(KEY_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Saving a new key drops the token minted from the old one. Empty disconnects. */
export function saveGarminKey(key: string): void {
  const k = key.trim();
  try {
    if (k) localStorage.setItem(KEY_KEY, k);
    else localStorage.removeItem(KEY_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  if (!k) setState({ ...EMPTY, followFtp: state.followFtp });
}

// --- Auth ---------------------------------------------------------------------

interface CachedToken { token: string; exp: number; key: string }

/** The JWT's exp claim, in ms. No signature check: Garmin checks it. */
function jwtExpiry(token: string): number {
  const part = token.split(".")[1];
  if (!part) throw new Error("Garmin returned a token Varg cannot read");
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
  const exp = (JSON.parse(json) as { exp?: unknown }).exp;
  if (typeof exp !== "number") throw new Error("Garmin's token carries no expiry");
  return exp * 1000;
}

async function bearer(key: string): Promise<string> {
  try {
    const cached = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null") as CachedToken | null;
    // Same margin as Garmin's own client: renew with an hour to spare.
    if (cached?.key === key && cached.exp - Date.now() > 60 * 60 * 1000) return cached.token;
  } catch {
    // fall through to a fresh token
  }
  const res = await httpFetch(BASE + TOKEN_PATH, {
    method: "POST",
    headers: { Accept: "*/*", Authorization: `ApiKey ${key}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Garmin refused the API key. It may have expired or been deleted: create a new one in Garmin Connect.");
  }
  if (!res.ok) throw new Error(`Garmin token request failed: HTTP ${String(res.status)}`);
  const token = (await res.text()).trim();
  const exp = jwtExpiry(token);
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp, key } satisfies CachedToken));
  } catch {
    // ignore
  }
  return token;
}

/** GET a Garmin path. Resolves undefined on 204/404 (no data for that day). */
async function get<T>(token: string, path: string, params: Record<string, string | number> = {}): Promise<T | undefined> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const qs = q.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await httpFetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (res.status === 204 || res.status === 404) return undefined;
  if (res.status === 401) {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    throw new Error("Garmin rejected the token. Sync again; if it persists, renew the API key.");
  }
  if (!res.ok) throw new Error(`Garmin ${path.split("/")[1] ?? path}: HTTP ${String(res.status)}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : undefined;
}

// --- Parsing --------------------------------------------------------------------

/** The local calendar date, yyyy-MM-dd. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** "2026-08-31 22:01:18", GMT without a suffix. */
function gmt(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const ms = Date.parse(`${s.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/** The fields Varg reads from Garmin's responses; all of them may be missing. */
export interface RawActivity {
  activityId?: unknown; activityName?: unknown; activityType?: { typeKey?: unknown };
  beginTimestamp?: unknown; startTimeGMT?: unknown; elapsedDuration?: unknown; duration?: unknown;
  distance?: unknown; calories?: unknown; averageHR?: unknown; maxHR?: unknown;
  avgPower?: unknown; normPower?: unknown;
  hrTimeInZone_1?: unknown; hrTimeInZone_2?: unknown; hrTimeInZone_3?: unknown;
  hrTimeInZone_4?: unknown; hrTimeInZone_5?: unknown;
}
interface RawActivityDetail { summaryDTO?: { functionalThresholdPower?: unknown } }
interface RawSleep { sleepTimeSeconds?: unknown; sleepScores?: { overall?: { value?: unknown } } }
interface RawHrv { hrvSummary?: { lastNightAvg?: unknown; weeklyAvg?: unknown; status?: unknown } }
interface RawDaily { bodyBatteryAtWakeTime?: unknown; bodyBatteryMostRecentValue?: unknown; restingHeartRate?: unknown }

/** One entry from the activity search, trimmed. Undefined if it has no usable window. */
export function parseActivity(a: RawActivity): GarminActivity | undefined {
  const id = num(a.activityId);
  const start = num(a.beginTimestamp) ?? gmt(a.startTimeGMT);
  const seconds = num(a.elapsedDuration) ?? num(a.duration);
  if (id == null || start == null || seconds == null) return undefined;
  const type = a.activityType?.typeKey;
  const zones = [a.hrTimeInZone_1, a.hrTimeInZone_2, a.hrTimeInZone_3, a.hrTimeInZone_4, a.hrTimeInZone_5]
    .map((z) => num(z) ?? 0);
  return {
    id,
    name: typeof a.activityName === "string" && a.activityName.trim() ? a.activityName : "Garmin activity",
    type: typeof type === "string" ? type : "other",
    start,
    seconds,
    // Zero distance (strength, yoga) means none, not a 0 km outing.
    meters: num(a.distance) ? num(a.distance) : undefined,
    kcal: num(a.calories),
    avgHr: num(a.averageHR),
    maxHr: num(a.maxHR),
    avgPower: num(a.avgPower),
    normPower: num(a.normPower),
    hrZones: zones.some((z) => z > 0) ? zones : undefined,
  };
}

export function isRide(a: GarminActivity): boolean {
  return /cycl|bik|ride|spin/i.test(a.type);
}

/** "indoor_cycling" → "Indoor cycling". */
export function typeLabel(type: string): string {
  const s = type.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- Matching Varg sessions to the watch ----------------------------------------

/** A finished session's window, ms UTC; undefined while it is still open. */
function sessionWindow(s: Session): [number, number] | undefined {
  if (!s.finishedAt) return undefined;
  const a = new Date(s.date).getTime(), b = new Date(s.finishedAt).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : undefined;
}

/** Seconds the two windows share. */
export function overlapSeconds(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / 1000;
}

/** Shorter shared time than this is a coincidence, not the same workout. */
export const MIN_OVERLAP_S = 60;

/**
 * Pair each finished session with the watch activity it overlaps most.
 * The watch and Varg are started by hand, independently, so start times
 * never line up; the shared time does. Each activity goes to one session
 * at most, the pairs with the most shared time first.
 */
export function matchSessions(sessions: Session[], activities: GarminActivity[]): Map<string, GarminActivity> {
  const pairs: { session: string; activity: GarminActivity; overlap: number }[] = [];
  for (const s of sessions) {
    const w = sessionWindow(s);
    if (!w) continue;
    for (const a of activities) {
      const overlap = overlapSeconds(w, [a.start, a.start + a.seconds * 1000]);
      if (overlap >= MIN_OVERLAP_S) pairs.push({ session: s.id, activity: a, overlap });
    }
  }
  pairs.sort((x, y) => y.overlap - x.overlap);
  const out = new Map<string, GarminActivity>();
  const taken = new Set<number>();
  for (const p of pairs) {
    if (out.has(p.session) || taken.has(p.activity.id)) continue;
    out.set(p.session, p.activity);
    taken.add(p.activity.id);
  }
  return out;
}

// --- Sync ----------------------------------------------------------------------

async function syncActivities(token: string): Promise<GarminActivity[]> {
  const now = Date.now();
  const since = state.lastSync
    ? new Date(state.lastSync).getTime() - RESYNC_OVERLAP_DAYS * 864e5
    : now - FIRST_SYNC_DAYS * 864e5;
  const fetched: GarminActivity[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const list = await get<RawActivity[]>(token, "/activitylist-service/activities/search/activities", {
      start: page * PAGE,
      limit: PAGE,
      startDate: localDate(since),
      endDate: localDate(now + 864e5),
    });
    const rows = Array.isArray(list) ? list : [];
    for (const r of rows) {
      const a = parseActivity(r);
      if (a) fetched.push(a);
    }
    if (rows.length < PAGE) break;
  }
  const byId = new Map(state.activities.map((a) => [a.id, a]));
  for (const a of fetched) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => b.start - a.start);
}

/**
 * FTP is not in the profile; each ride records the FTP in force when it
 * was ridden. The newest ride that has one is the current figure.
 */
async function fetchFtp(token: string): Promise<GarminFtp> {
  const list = await get<RawActivity[]>(token, "/activitylist-service/activities/search/activities", {
    start: 0,
    limit: 5,
    activityType: "cycling",
  });
  const rides = (Array.isArray(list) ? list : []).map(parseActivity).filter((a): a is GarminActivity => !!a);
  if (rides.length === 0) throw new Error("No rides on Garmin yet, so no FTP to take");
  for (const ride of rides) {
    const detail = await get<RawActivityDetail>(token, `/activity-service/activity/${String(ride.id)}`);
    const watts = num(detail?.summaryDTO?.functionalThresholdPower);
    if (watts != null && watts >= 50 && watts <= 600) {
      return { watts: Math.round(watts), activityId: ride.id, activityName: ride.name, rideStart: ride.start };
    }
  }
  throw new Error(`None of your last ${String(rides.length)} rides on Garmin carries an FTP`);
}

async function fetchReadiness(token: string): Promise<GarminReadiness> {
  const date = localDate(Date.now());
  const r: GarminReadiness = { date, errors: [] };
  const part = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      r.errors.push(`${what}: ${errorText(e)}`);
    }
  };
  await Promise.all([
    part("Sleep", async () => {
      // The spec returns the sleep object itself; older responses wrapped it.
      const raw = await get<RawSleep & { dailySleepDTO?: RawSleep }>(token, "/sleep-service/sleep/dailySleep", { date });
      const s = raw?.dailySleepDTO ?? raw;
      r.sleepSeconds = num(s?.sleepTimeSeconds);
      r.sleepScore = num(s?.sleepScores?.overall?.value);
    }),
    part("HRV", async () => {
      const h = await get<RawHrv>(token, `/hrv-service/hrv/${date}`);
      r.hrvLastNight = num(h?.hrvSummary?.lastNightAvg);
      r.hrvWeekly = num(h?.hrvSummary?.weeklyAvg);
      const status = h?.hrvSummary?.status;
      r.hrvStatus = typeof status === "string" ? status : undefined;
    }),
    part("Daily summary", async () => {
      const d = await get<RawDaily>(token, "/usersummary-service/usersummary/daily", { calendarDate: date });
      r.bodyBatteryAtWake = num(d?.bodyBatteryAtWakeTime);
      r.bodyBatteryNow = num(d?.bodyBatteryMostRecentValue);
      r.restingHr = num(d?.restingHeartRate);
    }),
  ]);
  return r;
}

let running: Promise<void> | null = null;

/**
 * Pull everything. Without `force`, skips when there is no key or the
 * last attempt was recent. Each part fails on its own; a token failure
 * fails the lot, and says so.
 */
export function syncGarmin(force = false): Promise<void> {
  const key = loadGarminKey();
  if (!key) return Promise.resolve();
  if (running) return running;
  if (!force && state.lastAttempt && Date.now() - new Date(state.lastAttempt).getTime() < SYNC_EVERY_MS) {
    return Promise.resolve();
  }
  running = (async () => {
    setState({ syncing: true, lastAttempt: new Date().toISOString() });
    try {
      const token = await bearer(key);
      const [activities, readiness, ftp] = await Promise.all([
        syncActivities(token),
        fetchReadiness(token),
        fetchFtp(token).then(
          (f) => ({ ok: f }),
          (e: unknown) => ({ err: errorText(e) }),
        ),
      ]);
      const patch: Partial<GarminState> = {
        activities,
        readiness,
        lastSync: new Date().toISOString(),
        error: undefined,
      };
      if ("ok" in ftp) {
        patch.ftp = ftp.ok;
        patch.ftpError = undefined;
        if (state.followFtp && loadFtp() !== ftp.ok.watts) saveFtp(ftp.ok.watts);
      } else {
        patch.ftpError = ftp.err;
      }
      setState(patch);
    } catch (e) {
      setState({ error: errorText(e) });
    } finally {
      setState({ syncing: false });
      running = null;
    }
  })();
  return running;
}
