/**
 * The indoor bike: live power, cadence and energy over Bluetooth LE.
 *
 * The native side (src-tauri/plugins/varg-bike) only scans, connects and
 * queues raw packets. Everything that knows a byte layout is here, so it
 * is unit-tested (scripts/bike.test.ts):
 *
 * - FTMS Indoor Bike Data (0x2AD2): power, cadence and — on most bikes —
 *   the console's own total kcal.
 * - Cycling Power Measurement (0x2A63): power, and crank revolutions from
 *   which cadence is derived.
 *
 * Energy: when the bike reports total kcal, that is what counts — it is
 * the number on its console. Otherwise kcal is integrated from power, at
 * the bike-industry convention of 1 kcal per kJ of work (human efficiency
 * of ~24 % cancels the 4.184 kJ/kcal almost exactly).
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/persistence";

/** One parsed measurement. Fields a packet does not carry are undefined. */
export interface BikeSample {
  power?: number | undefined; // W
  cadence?: number | undefined; // rpm
  totalKcal?: number | undefined; // the bike's own running total
  crankRevs?: number | undefined; // cumulative, 16-bit wrapping
  crankTime?: number | undefined; // 1/1024 s, 16-bit wrapping
}

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

class Reader {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  get left(): number { return this.b.length - this.i; }
  u8(): number { return this.b[this.i++] ?? 0; }
  u16(): number { const v = (this.b[this.i] ?? 0) | ((this.b[this.i + 1] ?? 0) << 8); this.i += 2; return v; }
  s16(): number { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  u24(): number { const v = this.u16() | (this.u8() << 16); return v; }
  u32(): number { const v = this.u16() + this.u16() * 0x10000; return v; }
  skip(n: number): void { this.i += n; }
}

/** FTMS Indoor Bike Data, per the Fitness Machine Service spec §4.9. */
export function parseIndoorBikeData(hex: string): BikeSample {
  const r = new Reader(bytes(hex));
  const flags = r.u16();
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const out: BikeSample = {};
  if (!has(0)) r.skip(2); // instantaneous speed — present when "More Data" is 0
  if (has(1)) r.skip(2); // average speed
  if (has(2)) out.cadence = r.u16() / 2;
  if (has(3)) r.skip(2); // average cadence
  if (has(4)) r.skip(3); // total distance
  if (has(5)) r.skip(2); // resistance level
  if (has(6)) out.power = r.s16();
  if (has(7)) r.skip(2); // average power
  if (has(8)) {
    const total = r.u16();
    r.skip(3); // energy per hour (2) and per minute (1)
    // 0xFFFF means "not available".
    if (total !== 0xffff) out.totalKcal = total;
  }
  return out;
}

/** Cycling Power Measurement, per the Cycling Power Service spec §3.2. */
export function parsePowerMeasurement(hex: string): BikeSample {
  const r = new Reader(bytes(hex));
  const flags = r.u16();
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const out: BikeSample = { power: r.s16() };
  if (has(0)) r.skip(1); // pedal power balance
  if (has(2)) r.skip(2); // accumulated torque
  if (has(4)) r.skip(6); // wheel revolutions (4) + last wheel event time (2)
  if (has(5)) {
    out.crankRevs = r.u16();
    out.crankTime = r.u16();
  }
  return out;
}

export interface BikePacket {
  c: "2ad2" | "2a63";
  hex: string;
  t: number; // wall-clock ms
}

/**
 * Turns the packet stream into a ride: current power and cadence, and
 * kcal and work accumulated since the ride (re)started. Pure: feed packets,
 * read the totals.
 */
export class RideMeter {
  power = 0;
  cadence = 0;
  /** Accumulated since start: from the bike's own total when it has one. */
  kcal = 0;
  kj = 0;
  lastAt = 0;
  private bikeKcalStart: number | undefined;
  private bikeKcal: number | undefined;
  private lastPowerAt: number | undefined;
  private lastCrank: { revs: number; time: number; at: number } | undefined;
  /** Seconds and watt-seconds ridden, for an average. */
  seconds = 0;

  add(p: BikePacket): void {
    const s = p.c === "2ad2" ? parseIndoorBikeData(p.hex) : parsePowerMeasurement(p.hex);
    this.lastAt = p.t;
    if (s.power !== undefined) {
      if (this.lastPowerAt !== undefined) {
        // Integrate the previous power over the gap, capped so a dropout
        // never counts as minutes of riding.
        const dt = Math.min(5, Math.max(0, (p.t - this.lastPowerAt) / 1000));
        this.kj += (this.power * dt) / 1000;
        this.seconds += dt;
      }
      this.power = Math.max(0, s.power);
      this.lastPowerAt = p.t;
    }
    if (s.cadence !== undefined) this.cadence = s.cadence;
    if (s.crankRevs !== undefined && s.crankTime !== undefined) {
      const prev = this.lastCrank;
      if (prev) {
        const dRevs = (s.crankRevs - prev.revs + 0x10000) % 0x10000;
        const dTime = ((s.crankTime - prev.time + 0x10000) % 0x10000) / 1024;
        if (dRevs > 0 && dTime > 0) this.cadence = (dRevs / dTime) * 60;
        // No new crank event for 3 s: the pedals have stopped.
        else if (p.t - prev.at > 3000) this.cadence = 0;
      }
      if (!prev || dRevsChanged(prev.revs, s.crankRevs)) this.lastCrank = { revs: s.crankRevs, time: s.crankTime, at: p.t };
    }
    if (s.totalKcal !== undefined) {
      this.bikeKcalStart ??= s.totalKcal;
      this.bikeKcal = s.totalKcal;
    }
    this.kcal = this.bikeKcal !== undefined && this.bikeKcalStart !== undefined
      ? Math.max(0, this.bikeKcal - this.bikeKcalStart)
      : this.kj;
  }

  get avgPower(): number {
    return this.seconds > 0 ? (this.kj * 1000) / this.seconds : 0;
  }
}

function dRevsChanged(a: number, b: number): boolean {
  return a !== b;
}

/* ------------------------------- Transport ------------------------------- */

export type BikeState = "disconnected" | "connecting" | "discovering" | "connected";

export interface BikeRead {
  state: BikeState;
  protocol: "" | "ftms" | "cps";
  name: string;
  error?: string;
  packets: BikePacket[];
}

export interface FoundBike {
  address: string;
  name: string;
  rssi: number;
  protocol: "ftms" | "cps";
}

const DEVICE_KEY = "varg.bike.v1";
export const SIMULATED_ADDRESS = "simulated";

export function bikeAvailable(): boolean {
  return isTauri() && /Android/i.test(navigator.userAgent);
}

export function loadBike(): { address: string; name: string } | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as { address: string; name: string }) : null;
  } catch {
    return null;
  }
}

export function saveBike(b: { address: string; name: string } | null): void {
  try {
    if (b) localStorage.setItem(DEVICE_KEY, JSON.stringify(b));
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // remembered for this session only
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(`plugin:varg-bike|${cmd}`, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
  }
}

/**
 * A simulated bike for the browser build: a rider who settles at ~210 W and
 * 88 rpm, reported as FTMS packets so the real parser runs. Never offered
 * in the Android app.
 */
class Simulator {
  private start = 0;
  private lastT = 0;
  private kcal = 0;
  connected = false;
  connect() { this.start = Date.now(); this.lastT = this.start; this.kcal = 0; this.connected = true; }
  read(): BikeRead {
    if (!this.connected) return { state: "disconnected", protocol: "", name: "", packets: [] };
    const now = Date.now();
    const packets: BikePacket[] = [];
    for (let t = this.lastT + 1000; t <= now; t += 1000) {
      const watts = Math.round(210 + 25 * Math.sin((t - this.start) / 20000));
      this.kcal += watts / 1000;
      const flags = (1 << 2) | (1 << 6) | (1 << 8) | 1; // cadence, power, energy; no speed
      const b = [flags & 0xff, flags >> 8, 176, 0, watts & 0xff, (watts >> 8) & 0xff, Math.floor(this.kcal) & 0xff, Math.floor(this.kcal) >> 8, 0, 0, 0];
      packets.push({ c: "2ad2", hex: b.map((x) => x.toString(16).padStart(2, "0")).join(""), t });
      this.lastT = t;
    }
    return { state: "connected", protocol: "ftms", name: "Simulated bike", packets };
  }
}
const simulator = new Simulator();

export async function requestBikePermission(): Promise<boolean> {
  if (!bikeAvailable()) return true;
  return (await call<{ granted: boolean }>("ensure_permissions")).granted;
}

export async function scanBikes(seconds = 6): Promise<FoundBike[]> {
  if (!bikeAvailable()) return [{ address: SIMULATED_ADDRESS, name: "Simulated bike (browser only)", rssi: -40, protocol: "ftms" }];
  const r = await call<{ devices: FoundBike[]; error?: string }>("scan", { seconds });
  if (r.error && r.devices.length === 0) throw new Error(r.error);
  return r.devices;
}

export async function connectBike(address: string): Promise<void> {
  if (address === SIMULATED_ADDRESS) {
    if (bikeAvailable()) throw new Error("The simulated bike only exists in the browser build.");
    simulator.connect();
    return;
  }
  await call("connect", { address });
}

export async function disconnectBike(): Promise<void> {
  simulator.connected = false;
  if (bikeAvailable()) await call("disconnect");
}

/* ----------------------- Background (foreground service) ---------------------- */
// While a ride runs, a native foreground service keeps the bike connected,
// records every packet, shows the ride in a notification and plays its cues
// when Varg is off screen — someone watching a video through a zone-2 ride.
// In the browser build these are no-ops: there is no background there.

export async function startRideService(title: string, schedule: unknown): Promise<void> {
  if (bikeAvailable()) await call("start_ride", { title, schedule: JSON.stringify(schedule) });
}

export async function updateRideSchedule(schedule: unknown): Promise<void> {
  if (bikeAvailable()) await call("schedule", { schedule: JSON.stringify(schedule) });
}

/** Hand a generated voice clip to the service, to speak while Varg is away. */
export async function sendCueAudio(text: string, blob: Blob): Promise<void> {
  if (!bikeAvailable()) return;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const ext = blob.type.includes("wav") ? "wav" : "mp3";
  await call("cue_audio", { text, b64: btoa(bin), ext });
}

export async function stopRideService(): Promise<void> {
  if (bikeAvailable()) await call("stop_ride");
}

export async function readBike(): Promise<BikeRead> {
  if (!bikeAvailable()) return simulator.read();
  return call<BikeRead>("read");
}
