/**
 * Optional GPS for the run stages of for-time workouts.
 *
 * The measuring happens natively (src-tauri/plugins/varg-gps): an Android
 * foreground service that keeps counting distance while the phone is locked
 * and the WebView is frozen, and records the wall-clock moment the target
 * distance was reached. This module is the thin, honest wrapper — every
 * failure comes back as a reason the player shows, never as a quiet "off".
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/persistence";
import { formatSeconds } from "./units";

const SETTING_KEY = "varg.gps.v1";

export interface GpsStatus {
  running: boolean;
  startedAtMs: number;
  targetMeters: number;
  meters: number;
  /** Wall-clock ms the target distance was reached; 0 until then. */
  crossedAtMs: number;
  fixes: number;
  lastAccuracy: number;
  lastFixAtMs: number;
  locationEnabled: boolean;
  error?: string;
}

/** GPS needs the Android app; the web build and desktop never offer it. */
export function gpsAvailable(): boolean {
  return isTauri() && /Android/i.test(navigator.userAgent);
}

export function loadGpsEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveGpsEnabled(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? "1" : "0");
  } catch {
    // not persisted; the switch reverts next launch
  }
}

function reason(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(`plugin:varg-gps|${cmd}`, args);
  } catch (e) {
    throw new Error(reason(e));
  }
}

/** "granted", "denied", "prompt" … as the Tauri permission state reports it. */
export async function requestGpsPermission(): Promise<string> {
  const r = await call<{ location?: string }>("request_permissions");
  return r.location ?? "denied";
}

export async function checkGpsPermission(): Promise<string> {
  const r = await call<{ location?: string }>("check_permissions");
  return r.location ?? "denied";
}

/**
 * Start measuring a run stage. `targetMeters` 0 means measure only, never
 * auto-complete; `startMeters` resumes a stage reopened by Undo.
 */
export function startRun(targetMeters: number, startMeters = 0): Promise<GpsStatus> {
  return call<GpsStatus>("start", { targetMeters, startMeters });
}

export function stopRun(): Promise<GpsStatus> {
  return call<GpsStatus>("stop");
}

export function runStatus(): Promise<GpsStatus> {
  return call<GpsStatus>("status");
}

/** "5:12 /km", or "" when there is too little distance to say. */
export function formatPace(seconds: number, meters: number): string {
  if (meters < 50 || seconds <= 0) return "";
  const perKm = seconds / (meters / 1000);
  return `${formatSeconds(perKm)} /km`;
}
