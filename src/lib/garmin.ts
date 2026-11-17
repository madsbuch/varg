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
import { z } from "zod";
import { parseAs, parseJsonAs } from "./schema";

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
const GarminActivitySchema = z.strictObject({
  id: z.int(),
  name: z.string(),
  /** Garmin's type key: "running", "indoor_cycling", "strength_training"… */
  type: z.string(),
  start: z.number(),
  /** Elapsed, pauses included: the window the watch was running. */
  seconds: z.number(),
  meters: z.number().optional(),
  kcal: z.number().optional(),
  avgHr: z.number().optional(),
  maxHr: z.number().optional(),
  avgPower: z.number().optional(),
  normPower: z.number().optional(),
  /** Seconds in heart-rate zones 1-5. */
  hrZones: z.array(z.number()).optional(),
});
export type GarminActivity = z.infer<typeof GarminActivitySchema>;

const GarminFtpSchema = z.strictObject({
  watts: z.number(),
  activityId: z.int(),
  activityName: z.string(),
  /** When that ride started, ms UTC. */
  rideStart: z.number(),
});
export type GarminFtp = z.infer<typeof GarminFtpSchema>;

const GarminReadinessSchema = z.strictObject({
  /** The local calendar date it describes, yyyy-MM-dd. */
  date: z.string(),
  sleepSeconds: z.number().optional(),
  sleepScore: z.number().optional(),
  hrvLastNight: z.number().optional(),
  hrvWeekly: z.number().optional(),
  /** BALANCED, UNBALANCED, LOW, POOR… */
  hrvStatus: z.string().optional(),
  bodyBatteryAtWake: z.number().optional(),
  bodyBatteryNow: z.number().optional(),
  restingHr: z.number().optional(),
  /** Parts that failed, with why. The rest still shows. */
  errors: z.array(z.string()),
});
export type GarminReadiness = z.infer<typeof GarminReadinessSchema>;

/** The cache as stored (`syncing` is written but describes one run only). */
const GarminStateSchema = z.strictObject({
  activities: z.array(GarminActivitySchema),
  ftp: GarminFtpSchema.optional(),
  /** Why the last FTP lookup did not produce one. */
  ftpError: z.string().optional(),
  readiness: GarminReadinessSchema.optional(),
  /** Last sync that completed, ISO. */
  lastSync: z.string().optional(),
  /** Last attempt, ISO, successful or not. */
  lastAttempt: z.string().optional(),
  /** Set when the last sync failed outright; cleared by the next success. */
  error: z.string().optional(),
  /** Activities Garmin sent that did not read, each with why: shown in red. */
  problems: z.array(z.string()).optional(),
  /** Take FTP from Garmin. On by default; off keeps the FTP typed in Skipan. */
  followFtp: z.boolean(),
  syncing: z.boolean(),
});
export type GarminState = z.infer<typeof GarminStateSchema>;

const EMPTY: GarminState = { activities: [], followFtp: true, syncing: false };

/** The cache as stored. Unreadable, it is fetched again (and named in red). */
function readState(): GarminState {
  const stored = kvRead(STATE_KEY, GarminStateSchema);
  return stored ? { ...stored, syncing: false } : EMPTY;
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

const CachedTokenSchema = z.strictObject({ token: z.string().min(1), exp: z.number(), key: z.string() });
type CachedToken = z.infer<typeof CachedTokenSchema>;

/** The JWT's exp claim, in ms. No signature check: Garmin checks it. */
function jwtExpiry(token: string): number {
  const part = token.split(".")[1];
  if (!part) throw new Error("Garmin returned a token Varg cannot read");
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
  const claims = parseJsonAs(z.object({ exp: z.number() }), json, "token");
  if (!claims.ok) throw new Error(`Garmin's token carries no expiry (${claims.problems.join("; ")})`);
  return claims.value.exp * 1000;
}

async function bearer(key: string): Promise<string> {
  const cached = kvRead(TOKEN_KEY, CachedTokenSchema);
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

/**
 * GET a Garmin path and read the answer as `schema`. Resolves undefined on
 * 204/404 (no data for that day); throws with every problem when the answer
 * is not what the schema says, so the part fails in red.
 */
async function get<S extends z.ZodType>(token: string, path: string, schema: S, params: Record<string, string | number> = {}): Promise<z.infer<S> | undefined> {
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
  const what = path.split("/")[1] ?? path;
  const parsed = parseJsonAs(schema, text, what);
  if (!parsed.ok) throw new Error(`Garmin ${what}: ${parsed.problems.slice(0, 3).join("; ")}`);
  return parsed.value;
}

// --- Parsing --------------------------------------------------------------------

/** The local calendar date, yyyy-MM-dd. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-08-31 22:01:18", GMT without a suffix. */
function gmt(s: string | null | undefined): number | undefined {
  if (s === null || s === undefined) return undefined;
  const ms = Date.parse(`${s.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/*
 * Garmin's answers, as far as Varg reads them. Every field may be missing or
 * null (Garmin's "no data"); one that is there must be the type said here,
 * or the answer is refused with why. Fields Varg does not read are ignored.
 */
const num = z.number().nullish();
const RawActivitySchema = z.object({
  activityId: z.int().nullish(),
  activityName: z.string().nullish(),
  activityType: z.object({ typeKey: z.string().nullish() }).nullish(),
  beginTimestamp: num,
  startTimeGMT: z.string().nullish(),
  elapsedDuration: num,
  duration: num,
  distance: num,
  calories: num,
  averageHR: num,
  maxHR: num,
  avgPower: num,
  normPower: num,
  hrTimeInZone_1: num,
  hrTimeInZone_2: num,
  hrTimeInZone_3: num,
  hrTimeInZone_4: num,
  hrTimeInZone_5: num,
});
const RawDetailSchema = z.object({ summaryDTO: z.object({ functionalThresholdPower: num }).nullish() });
const RawSleepCore = z.object({
  sleepTimeSeconds: num,
  sleepScores: z.object({ overall: z.object({ value: num }).nullish() }).nullish(),
});
const RawSleepSchema = RawSleepCore.extend({ dailySleepDTO: RawSleepCore.nullish() });
const RawHrvSchema = z.object({
  hrvSummary: z.object({ lastNightAvg: num, weeklyAvg: num, status: z.string().nullish() }).nullish(),
});
const RawDailySchema = z.object({ bodyBatteryAtWakeTime: num, bodyBatteryMostRecentValue: num, restingHeartRate: num });

/** null and undefined alike are "no data". */
const has = (v: number | null | undefined): number | undefined => (v === null ? undefined : v);
const has_s = (v: string | null | undefined): string | undefined => (v === null ? undefined : v);

/**
 * One entry from the activity search, trimmed. `activity` is undefined when
 * it has no usable window (a manual entry with no start); `problem` says why
 * when Garmin sent a field of the wrong type.
 */
export function readActivity(raw: unknown): { activity?: GarminActivity; problem?: string } {
  const parsed = parseAs(RawActivitySchema, raw, "activity");
  if (!parsed.ok) return { problem: parsed.problems.join("; ") };
  const a = parsed.value;
  const id = has(a.activityId);
  const start = has(a.beginTimestamp) ?? gmt(a.startTimeGMT);
  const seconds = has(a.elapsedDuration) ?? has(a.duration);
  if (id === undefined || start === undefined || seconds === undefined) return {};
  const zones = [a.hrTimeInZone_1, a.hrTimeInZone_2, a.hrTimeInZone_3, a.hrTimeInZone_4, a.hrTimeInZone_5].map((z) => has(z) ?? 0);
  const name = has_s(a.activityName);
  const meters = has(a.distance);
  return {
    activity: {
      id,
      name: name !== undefined && name.trim() !== "" ? name : "Garmin activity",
      type: has_s(a.activityType?.typeKey) ?? "other",
      start,
      seconds,
      // Zero distance (strength, yoga) means none, not a 0 km outing.
      meters: meters !== undefined && meters > 0 ? meters : undefined,
      kcal: has(a.calories),
      avgHr: has(a.averageHR),
      maxHr: has(a.maxHR),
      avgPower: has(a.avgPower),
      normPower: has(a.normPower),
      hrZones: zones.some((z) => z > 0) ? zones : undefined,
    },
  };
}

/** The activity, if it has a usable window and reads. */
export function parseActivity(raw: unknown): GarminActivity | undefined {
  return readActivity(raw).activity;
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

async function syncActivities(token: string): Promise<{ activities: GarminActivity[]; problems: string[] }> {
  const now = Date.now();
  const since = state.lastSync
    ? new Date(state.lastSync).getTime() - RESYNC_OVERLAP_DAYS * 864e5
    : now - FIRST_SYNC_DAYS * 864e5;
  const fetched: GarminActivity[] = [];
  const problems: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await get(token, "/activitylist-service/activities/search/activities", z.array(z.unknown()), {
      start: page * PAGE,
      limit: PAGE,
      startDate: localDate(since),
      endDate: localDate(now + 864e5),
    });
    const rows = answer ?? [];
    for (const r of rows) {
      const read = readActivity(r);
      if (read.activity) fetched.push(read.activity);
      if (read.problem !== undefined) problems.push(read.problem);
    }
    if (rows.length < PAGE) break;
  }
  const byId = new Map(state.activities.map((a) => [a.id, a]));
  for (const a of fetched) byId.set(a.id, a);
  return { activities: [...byId.values()].sort((a, b) => b.start - a.start), problems };
}

/**
 * FTP is not in the profile; each ride records the FTP in force when it
 * was ridden. The newest ride that has one is the current figure.
 */
async function fetchFtp(token: string): Promise<GarminFtp> {
  const answer = await get(token, "/activitylist-service/activities/search/activities", z.array(z.unknown()), {
    start: 0,
    limit: 5,
    activityType: "cycling",
  });
  const rides = (answer ?? []).map(parseActivity).filter((a): a is GarminActivity => a !== undefined);
  if (rides.length === 0) throw new Error("No rides on Garmin yet, so no FTP to take");
  for (const ride of rides) {
    const detail = await get(token, `/activity-service/activity/${ride.id}`, RawDetailSchema);
    const watts = has(detail?.summaryDTO?.functionalThresholdPower);
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
      const raw = await get(token, "/sleep-service/sleep/dailySleep", RawSleepSchema, { date });
      const s = raw?.dailySleepDTO ?? raw;
      r.sleepSeconds = has(s?.sleepTimeSeconds);
      r.sleepScore = has(s?.sleepScores?.overall?.value);
    }),
    part("HRV", async () => {
      const h = await get(token, `/hrv-service/hrv/${date}`, RawHrvSchema);
      r.hrvLastNight = has(h?.hrvSummary?.lastNightAvg);
      r.hrvWeekly = has(h?.hrvSummary?.weeklyAvg);
      r.hrvStatus = has_s(h?.hrvSummary?.status);
    }),
    part("Daily summary", async () => {
      const d = await get(token, "/usersummary-service/usersummary/daily", RawDailySchema, { calendarDate: date });
      r.bodyBatteryAtWake = has(d?.bodyBatteryAtWakeTime);
      r.bodyBatteryNow = has(d?.bodyBatteryMostRecentValue);
      r.restingHr = has(d?.restingHeartRate);
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
      const [synced, readiness, ftp] = await Promise.all([
        syncActivities(token),
        fetchReadiness(token),
        fetchFtp(token).then(
          (f) => ({ ok: f }),
          (e: unknown) => ({ err: errorText(e) }),
        ),
      ]);
      const patch: Partial<GarminState> = {
        activities: synced.activities,
        problems: synced.problems.length > 0 ? synced.problems : undefined,
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
