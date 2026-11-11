/**
 * Heart rate from a chest strap over Bluetooth LE (Garmin HRM 600 and any
 * other strap that speaks the standard Heart Rate Service).
 *
 * The native side (src-tauri/plugins/varg-hr) only scans, connects,
 * reconnects and queues raw packets. Everything that knows a byte layout
 * is here, so it is unit-tested (scripts/hr.test.ts):
 *
 * - Heart Rate Measurement (0x2A37), per the Heart Rate Service spec §3.1:
 *   a flags byte, the rate as uint8 or uint16, then optional energy
 *   expended and RR intervals.
 *
 * A strap that reports "no skin contact", or a rate of 0, is not a reading:
 * the recorder leaves a gap and the player shows the problem in red rather
 * than holding the last number.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/persistence";
import type { HeartRate, Session } from "../types";

/** One parsed measurement. */
export interface HrSample {
  bpm: number;
  /** undefined when the strap does not report skin contact at all. */
  contact?: boolean | undefined;
  /** Beat-to-beat intervals in milliseconds, when the strap sends them. */
  rr?: number[] | undefined;
}

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Heart Rate Measurement (0x2A37). */
export function parseHeartRate(hex: string): HrSample {
  const b = bytes(hex);
  const flags = b[0] ?? 0;
  let i = 1;
  const u8 = () => b[i++] ?? 0;
  const u16 = () => { const v = (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8); i += 2; return v; };
  const out: HrSample = { bpm: flags & 0x01 ? u16() : u8() };
  // Bit 2: contact detection supported; bit 1: contact detected.
  if (flags & 0x04) out.contact = (flags & 0x02) !== 0;
  if (flags & 0x08) i += 2; // energy expended, kJ
  if (flags & 0x10) {
    const rr: number[] = [];
    while (i + 1 < b.length) rr.push((u16() * 1000) / 1024);
    out.rr = rr;
  }
  return out;
}

export interface HrPacket {
  hex: string;
  t: number; // wall-clock ms
}

/** A reading older than this is no longer the current heart rate. */
export const STALE_MS = 5000;
/** The stored trace has one value per this many seconds. */
export const TRACE_EVERY = 5;

/**
 * Turns the packet stream into a workout's heart rate. Pure: feed packets,
 * read the current rate or a summary of any window.
 */
export class HrRecorder {
  /** Valid readings in arrival order. */
  readonly samples: { t: number; bpm: number }[] = [];
  /** Last packet of any kind, valid or not. */
  lastAt = 0;
  /** The last packet said the strap has no skin contact. */
  noContact = false;

  add(p: HrPacket): void {
    const s = parseHeartRate(p.hex);
    this.lastAt = p.t;
    this.noContact = s.contact === false;
    if (this.noContact || s.bpm <= 0) return;
    this.samples.push({ t: p.t, bpm: s.bpm });
  }

  /**
   * The heart rate at wall-clock `t`: the last reading at or before it, if
   * no older than STALE_MS. For replaying a ride's packets at their own time.
   */
  at(t: number): number | null {
    let lo = 0, hi = this.samples.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.samples[mid]?.t ?? 0) <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const s = this.samples[found];
    return s && t - s.t <= STALE_MS ? s.bpm : null;
  }

  /** The current heart rate, or null when the last reading is too old. */
  current(now: number): number | null {
    const last = this.samples[this.samples.length - 1];
    if (!last || this.noContact || now - last.t > STALE_MS) return null;
    return last.bpm;
  }

  /**
   * Average, maximum and a trace for [from, to]. The average is weighted by
   * time: each reading holds until the next, but never across a gap longer
   * than STALE_MS — a dropout is not minutes at the last rate. Undefined
   * when the window holds no readings.
   */
  summary(from: number, to: number): HeartRate | undefined {
    const inside = this.samples.filter((s) => s.t >= from && s.t <= to);
    if (inside.length === 0) return undefined;
    let weighted = 0;
    let seconds = 0;
    let max = 0;
    inside.forEach((s, k) => {
      const next = inside[k + 1]?.t ?? to;
      const dt = Math.min(STALE_MS, Math.max(0, next - s.t)) / 1000;
      weighted += s.bpm * dt;
      seconds += dt;
      max = Math.max(max, s.bpm);
    });
    const avg = seconds > 0 ? weighted / seconds : inside.reduce((a, s) => a + s.bpm, 0) / inside.length;
    const buckets = Math.max(1, Math.ceil((to - from) / 1000 / TRACE_EVERY));
    const sum = new Array<number>(buckets).fill(0);
    const n = new Array<number>(buckets).fill(0);
    for (const s of inside) {
      const k = Math.min(buckets - 1, Math.floor((s.t - from) / 1000 / TRACE_EVERY));
      sum[k] = (sum[k] ?? 0) + s.bpm;
      n[k] = (n[k] ?? 0) + 1;
    }
    return {
      avg: Math.round(avg),
      max,
      every: TRACE_EVERY,
      // 0 marks a stretch with no reading: the strap was off or out of range.
      trace: sum.map((v, k) => ((n[k] ?? 0) > 0 ? Math.round(v / (n[k] ?? 1)) : 0)),
    };
  }
}

/* ------------------------------ Zones ------------------------------------ */

/**
 * The rider's heart-rate zones, copied from Garmin Connect (Settings →
 * User Settings → Heart Rate Zones) so Varg's zone 2 is the watch's zone 2:
 * the lowest bpm of zones 1-5, and the maximum heart rate that tops zone 5.
 */
export interface HrZones {
  floors: [number, number, number, number, number];
  max: number;
}

/** Garmin's names for its five zones. */
export const HR_ZONE_NAMES = ["Warm up", "Easy", "Aerobic", "Threshold", "Maximum"] as const;
/** Garmin's default zones as % of max heart rate: each zone's floor. */
export const GARMIN_DEFAULT_PCT = [50, 60, 70, 80, 90] as const;

const ZONES_KEY = "varg.hr.zones.v1";

/** Why these zones cannot be used, or null when they can. */
export function hrZonesProblem(z: HrZones): string | null {
  const all = [...z.floors, z.max];
  if (!all.every((v) => Number.isInteger(v) && v >= 40 && v <= 230)) return "Every value must be a whole number of bpm between 40 and 230.";
  for (let i = 1; i < all.length; i++) {
    if ((all[i] ?? 0) <= (all[i - 1] ?? 0)) return i < 5 ? `Zone ${String(i + 1)} must start above zone ${String(i)}.` : "Max heart rate must be above where zone 5 starts.";
  }
  return null;
}

export function loadHrZones(): HrZones | null {
  try {
    const raw = localStorage.getItem(ZONES_KEY);
    if (!raw) return null;
    // Parsed as unknown: a stored value from an older shape must not pass.
    const z = JSON.parse(raw) as { floors?: unknown; max?: unknown };
    if (!Array.isArray(z.floors) || z.floors.length !== 5 || typeof z.max !== "number") return null;
    const zones = { floors: z.floors as HrZones["floors"], max: z.max };
    return hrZonesProblem(zones) === null ? zones : null;
  } catch {
    return null;
  }
}

export function saveHrZones(z: HrZones | null): void {
  try {
    if (z) localStorage.setItem(ZONES_KEY, JSON.stringify(z));
    else localStorage.removeItem(ZONES_KEY);
  } catch {
    // remembered for this session only
  }
}

/** Garmin's default %-of-max zones for a max heart rate. */
export function zonesFromMax(max: number): HrZones {
  const f = GARMIN_DEFAULT_PCT.map((p) => Math.round((max * p) / 100));
  return { floors: [f[0] ?? 0, f[1] ?? 0, f[2] ?? 0, f[3] ?? 0, f[4] ?? 0], max };
}

/** Zone `n` (1-5) in bpm, both ends inclusive, like Garmin shows it. */
export function hrZoneRange(z: HrZones, n: number): [number, number] {
  const lo = z.floors[n - 1] ?? 0;
  const next = z.floors[n];
  return [lo, next !== undefined ? next - 1 : z.max];
}

/** Which zone a heart rate is in: 0 below zone 1, 1-5, 5 above max too. */
export function hrZoneOf(bpm: number, z: HrZones): number {
  let zone = 0;
  z.floors.forEach((f, i) => { if (bpm >= f) zone = i + 1; });
  return zone;
}

/** The session with its heart rate over its own start → finish window. */
export function withHeartRate(session: Session, rec: HrRecorder | null): Session {
  if (!rec || !session.finishedAt) return session;
  const hr = rec.summary(new Date(session.date).getTime(), new Date(session.finishedAt).getTime());
  return hr ? { ...session, heartRate: hr } : session;
}

/* ------------------------------- Transport ------------------------------- */

export type HrState = "disconnected" | "connecting" | "discovering" | "connected" | "reconnecting";

export interface HrRead {
  state: HrState;
  name: string;
  error?: string;
  /** The background service failed to start (it never takes the app down). */
  serviceError?: string;
  packets: HrPacket[];
}

export interface FoundStrap {
  address: string;
  name: string;
  rssi: number;
}

const DEVICE_KEY = "varg.hr.v1";
export const SIMULATED_STRAP = "simulated";

export function hrAvailable(): boolean {
  return isTauri() && /Android/i.test(navigator.userAgent);
}

export function loadStrap(): { address: string; name: string } | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as { address: string; name: string }) : null;
  } catch {
    return null;
  }
}

export function saveStrap(s: { address: string; name: string } | null): void {
  try {
    if (s) localStorage.setItem(DEVICE_KEY, JSON.stringify(s));
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // remembered for this session only
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(`plugin:varg-hr|${cmd}`, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
  }
}

/**
 * A simulated strap for the browser build: a heart that climbs from 95 and
 * swings with the work, reported as real 0x2A37 packets so the parser
 * runs. Never offered in the Android app.
 */
class Simulator {
  private start = 0;
  private lastT = 0;
  connected = false;
  connect() { this.start = Date.now(); this.lastT = this.start; this.connected = true; }
  read(): HrRead {
    if (!this.connected) return { state: "disconnected", name: "", packets: [] };
    const now = Date.now();
    const packets: HrPacket[] = [];
    for (let t = this.lastT + 1000; t <= now; t += 1000) {
      const s = (t - this.start) / 1000;
      const bpm = Math.round(95 + Math.min(50, s / 6) + 15 * Math.sin(s / 25));
      packets.push({ hex: `06${bpm.toString(16).padStart(2, "0")}`, t });
      this.lastT = t;
    }
    return { state: "connected", name: "Simulated strap", packets };
  }
}
const simulator = new Simulator();

export async function requestHrPermission(): Promise<boolean> {
  if (!hrAvailable()) return true;
  return (await call<{ granted: boolean }>("ensure_permissions")).granted;
}

export async function scanStraps(seconds = 6): Promise<FoundStrap[]> {
  if (!hrAvailable()) return [{ address: SIMULATED_STRAP, name: "Simulated strap (browser only)", rssi: -40 }];
  const r = await call<{ devices: FoundStrap[]; error?: string }>("scan", { seconds });
  if (r.error && r.devices.length === 0) throw new Error(r.error);
  return r.devices;
}

export async function connectStrap(address: string): Promise<void> {
  if (address === SIMULATED_STRAP) {
    if (hrAvailable()) throw new Error("The simulated strap only exists in the browser build.");
    simulator.connect();
    return;
  }
  await call("connect", { address });
}

export async function disconnectStrap(): Promise<void> {
  simulator.connected = false;
  if (hrAvailable()) await call("disconnect");
}

export async function readHr(): Promise<HrRead> {
  if (!hrAvailable()) return simulator.read();
  return call<HrRead>("read");
}

// While a workout runs, a native foreground service keeps the strap
// connected and recording with the phone locked. No-ops in the browser.

export async function startHrService(title: string): Promise<void> {
  if (hrAvailable()) await call("start_service", { title });
}

export async function stopHrService(): Promise<void> {
  if (hrAvailable()) await call("stop_service");
}
