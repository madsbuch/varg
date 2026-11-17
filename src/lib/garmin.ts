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
 * which is why it lives in the settings store (kv.ts), not the training data.
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
import { kvGet, kvRead, kvRemove, kvSet } from "./kv";
import { at, numberOr, parseJson, Reader, stringOr } from "./decode";

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

function readStoredActivity(r: Reader, v: unknown, path: string): GarminActivity {
  const f = r.obj(v, path);
  const zones = f.get("hrZones");
  return {
    id: r.int(f.get("id"), `${path}.id`),
    name: r.text(f.get("name"), `${path}.name`),
    type: r.text(f.get("type"), `${path}.type`),
    start: r.num(f.get("start"), `${path}.start`),
    seconds: r.num(f.get("seconds"), `${path}.seconds`),
    meters: r.optNum(f.get("meters"), `${path}.meters`),
    kcal: r.optNum(f.get("kcal"), `${path}.kcal`),
    avgHr: r.optNum(f.get("avgHr"), `${path}.avgHr`),
    maxHr: r.optNum(f.get("maxHr"), `${path}.maxHr`),
    avgPower: r.optNum(f.get("avgPower"), `${path}.avgPower`),
    normPower: r.optNum(f.get("normPower"), `${path}.normPower`),
    hrZones: zones === undefined || zones === null ? undefined : r.arr(zones, `${path}.hrZones`).map((z, i) => r.num(z, `${path}.hrZones[${i}]`)),
  };
}

function readStoredState(r: Reader, v: unknown): GarminState {
  const f = r.obj(v, "garmin");
  const ftp = r.optObj(f.get("ftp"), "garmin.ftp");
  const rd = r.optObj(f.get("readiness"), "garmin.readiness");
  const n = (o: ReadonlyMap<string, unknown>, k: string) => r.optNum(o.get(k), `garmin.readiness.${k}`);
  return {
    activities: r.arr(f.get("activities"), "garmin.activities").map((a, i) => readStoredActivity(r, a, `garmin.activities[${i}]`)),
    ftp: ftp && {
      watts: r.num(ftp.get("watts"), "garmin.ftp.watts"),
      activityId: r.int(ftp.get("activityId"), "garmin.ftp.activityId"),
      activityName: r.text(ftp.get("activityName"), "garmin.ftp.activityName"),
      rideStart: r.num(ftp.get("rideStart"), "garmin.ftp.rideStart"),
    },
    ftpError: r.optStr(f.get("ftpError"), "garmin.ftpError"),
    readiness: rd && {
      date: r.str(rd.get("date"), "garmin.readiness.date"),
      sleepSeconds: n(rd, "sleepSeconds"),
      sleepScore: n(rd, "sleepScore"),
      hrvLastNight: n(rd, "hrvLastNight"),
      hrvWeekly: n(rd, "hrvWeekly"),
      hrvStatus: r.optStr(rd.get("hrvStatus"), "garmin.readiness.hrvStatus"),
      bodyBatteryAtWake: n(rd, "bodyBatteryAtWake"),
      bodyBatteryNow: n(rd, "bodyBatteryNow"),
      restingHr: n(rd, "restingHr"),
      errors: r.arr(rd.get("errors"), "garmin.readiness.errors").map((e, i) => r.text(e, `garmin.readiness.errors[${i}]`)),
    },
    lastSync: r.optStr(f.get("lastSync"), "garmin.lastSync"),
    lastAttempt: r.optStr(f.get("lastAttempt"), "garmin.lastAttempt"),
    error: r.optStr(f.get("error"), "garmin.error"),
    followFtp: r.bool(f.get("followFtp"), "garmin.followFtp"),
    syncing: false,
  };
}

/** The cache as stored. Unreadable, it is fetched again (and named in red). */
function readState(): GarminState {
  return kvRead(STATE_KEY, readStoredState) ?? EMPTY;
}

let state: GarminState = readState();
const listeners = new Set<() => void>();

function setState(patch: Partial<GarminState>): void {
  state = { ...state, ...patch };
  try {
    // `syncing` describes this run only; readState resets it anyway.
    kvSet(STATE_KEY, JSON.stringify({ ...state, syncing: false }));
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

/** The cached Garmin state, outside React (Mímir reads it). */
export function garminSnapshot(): GarminState {
  return state;
}

export function setFollowFtp(on: boolean): void {
  setState({ followFtp: on });
  if (on && state.ftp) saveFtp(state.ftp.watts);
}

// --- The key -------------------------------------------------------------------

export function loadGarminKey(): string {
  try {
    return kvGet(KEY_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Saving a new key drops the token minted from the old one. Empty disconnects. */
export function saveGarminKey(key: string): void {
  const k = key.trim();
  try {
    if (k) kvSet(KEY_KEY, k);
    else kvRemove(KEY_KEY);
    kvRemove(TOKEN_KEY);
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
  const parsed = parseJson(json);
  const exp = parsed.ok ? numberOr(at(parsed.value, "exp")) : undefined;
  if (exp === undefined) throw new Error("Garmin's token carries no expiry");
  return exp * 1000;
}

async function bearer(key: string): Promise<string> {
  const cached = kvRead(TOKEN_KEY, (r, v): CachedToken => {
    const f = r.obj(v, "token");
    return { token: r.str(f.get("token"), "token.token"), exp: r.num(f.get("exp"), "token.exp"), key: r.text(f.get("key"), "token.key") };
  });
  // Same margin as Garmin's own client: renew with an hour to spare.
  if (cached?.key === key && cached.exp - Date.now() > 60 * 60 * 1000) return cached.token;
  const res = await httpFetch(BASE + TOKEN_PATH, {
    method: "POST",
    headers: { Accept: "*/*", Authorization: `ApiKey ${key}` },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Garmin refused the API key. It may have expired or been deleted: create a new one in Garmin Connect.");
  }
  if (!res.ok) throw new Error(`Garmin token request failed: HTTP ${res.status}`);
  const token = (await res.text()).trim();
  const exp = jwtExpiry(token);
  try {
    kvSet(TOKEN_KEY, JSON.stringify({ token, exp, key } satisfies CachedToken));
  } catch {
    // ignore
  }
  return token;
}

/** GET a Garmin path. Resolves undefined on 204/404 (no data for that day). */
async function get(token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, typeof v === "number" ? v.toString() : v]));
  const qs = q.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await httpFetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
  if (res.status === 204 || res.status === 404) return undefined;
  if (res.status === 401) {
    try { kvRemove(TOKEN_KEY); } catch { /* ignore */ }
    throw new Error("Garmin rejected the token. Sync again; if it persists, renew the API key.");
  }
  if (!res.ok) throw new Error(`Garmin ${path.split("/")[1] ?? path}: HTTP ${res.status}`);
  const text = await res.text();
  if (text === "") return undefined;
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(`Garmin ${path.split("/")[1] ?? path}: not JSON (${parsed.error})`);
  return parsed.value;
}

// --- Parsing --------------------------------------------------------------------

/** The local calendar date, yyyy-MM-dd. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const num = numberOr;

/** "2026-08-31 22:01:18", GMT without a suffix. */
function gmt(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const ms = Date.parse(`${s.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * One entry from the activity search, trimmed. Undefined if it has no
 * usable window. Every field Garmin sends may be missing or another type:
 * each is read with `at` and checked, none assumed.
 */
export function parseActivity(a: unknown): GarminActivity | undefined {
  const id = num(at(a, "activityId"));
  const start = num(at(a, "beginTimestamp")) ?? gmt(at(a, "startTimeGMT"));
  const seconds = num(at(a, "elapsedDuration")) ?? num(at(a, "duration"));
  if (id === undefined || start === undefined || seconds === undefined) return undefined;
  const type = stringOr(at(a, "activityType", "typeKey"));
  const name = stringOr(at(a, "activityName"));
  const zones = [1, 2, 3, 4, 5].map((z) => num(at(a, `hrTimeInZone_${z}`)) ?? 0);
  const meters = num(at(a, "distance"));
  return {
    id,
    name: name !== undefined && name.trim() !== "" ? name : "Garmin activity",
    type: type ?? "other",
    start,
    seconds,
    // Zero distance (strength, yoga) means none, not a 0 km outing.
    meters: meters !== undefined && meters > 0 ? meters : undefined,
    kcal: num(at(a, "calories")),
    avgHr: num(at(a, "averageHR")),
    maxHr: num(at(a, "maxHR")),
    avgPower: num(at(a, "avgPower")),
    normPower: num(at(a, "normPower")),
    hrZones: zones.some((z) => z > 0) ? zones : undefined,
  };
}

/** Garmin's list answers: the array, or nothing when it sent something else. */
function list(v: unknown): readonly unknown[] {
  if (!Array.isArray(v)) return [];
  const xs: readonly unknown[] = v;
  return xs;
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
    const answer = await get(token, "/activitylist-service/activities/search/activities", {
      start: page * PAGE,
      limit: PAGE,
      startDate: localDate(since),
      endDate: localDate(now + 864e5),
    });
    const rows = list(answer);
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
  const answer = await get(token, "/activitylist-service/activities/search/activities", {
    start: 0,
    limit: 5,
    activityType: "cycling",
  });
  const rides = list(answer).map(parseActivity).filter((a): a is GarminActivity => a !== undefined);
  if (rides.length === 0) throw new Error("No rides on Garmin yet, so no FTP to take");
  for (const ride of rides) {
    const detail = await get(token, `/activity-service/activity/${ride.id}`);
    const watts = num(at(detail, "summaryDTO", "functionalThresholdPower"));
    if (watts != null && watts >= 50 && watts <= 600) {
      return { watts: Math.round(watts), activityId: ride.id, activityName: ride.name, rideStart: ride.start };
    }
  }
  throw new Error(`None of your last ${rides.length} rides on Garmin carries an FTP`);
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
      const raw = await get(token, "/sleep-service/sleep/dailySleep", { date });
      const s = at(raw, "dailySleepDTO") ?? raw;
      r.sleepSeconds = num(at(s, "sleepTimeSeconds"));
      r.sleepScore = num(at(s, "sleepScores", "overall", "value"));
    }),
    part("HRV", async () => {
      const h = await get(token, `/hrv-service/hrv/${date}`);
      r.hrvLastNight = num(at(h, "hrvSummary", "lastNightAvg"));
      r.hrvWeekly = num(at(h, "hrvSummary", "weeklyAvg"));
      r.hrvStatus = stringOr(at(h, "hrvSummary", "status"));
    }),
    part("Daily summary", async () => {
      const d = await get(token, "/usersummary-service/usersummary/daily", { calendarDate: date });
      r.bodyBatteryAtWake = num(at(d, "bodyBatteryAtWakeTime"));
      r.bodyBatteryNow = num(at(d, "bodyBatteryMostRecentValue"));
      r.restingHr = num(at(d, "restingHeartRate"));
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
