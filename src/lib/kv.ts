/**
 * The app's settings and small state (FTP, keys, the music choice, the
 * Garmin cache…): one key/value table in the Rust store (the `settings`
 * table, src-tauri/store), read and written synchronously from here.
 *
 * Every row is loaded once, before the app's modules run (main.tsx awaits
 * `initKv`), so `kvGet` is a plain lookup and the many modules that read a
 * setting at import time see the stored value, never a default. Writes
 * update the cache at once and go to Rust in order; a failed write stays
 * queued, is retried, and is shown in red (`useKvFailure`) until it lands.
 *
 * Outside the app (vite in a browser) the same API sits on localStorage;
 * under `bun test` on memory.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Reader } from "./decode";
import { errorText } from "./http";

const cache = new Map<string, string>();
/** True once the Rust store's settings are loaded; until then (and outside the app) localStorage or memory. */
let rust = false;

/** The browser's storage, when the Rust store is not in use and there is one. */
function local(): Storage | undefined {
  return !rust && typeof localStorage !== "undefined" ? localStorage : undefined;
}

/** Set once Varg has copied the WebView's localStorage into Rust. */
const IMPORTED = "varg.kv.imported-from-webview.v1";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Open the store and read every setting. Throws with the reason. */
export async function initKv(): Promise<void> {
  if (!inTauri()) return;
  await invoke("store_open");
  const raw: unknown = await invoke("kv_all");
  const r = new Reader();
  const rows = r.arr(raw, "kv_all").map((row, i) => {
    const pair = r.arr(row, `kv_all[${i}]`);
    const kv: [string, string] = [r.text(pair[0], `kv_all[${i}][0]`), r.text(pair[1], `kv_all[${i}][1]`)];
    return kv;
  });
  if (!r.ok()) throw new Error(`Settings unreadable: ${r.problems.join("; ")}`);
  cache.clear();
  for (const [k, v] of rows) cache.set(k, v);
  rust = true;
  await importWebViewStorage();
}

/**
 * Before this release every setting lived in the WebView's localStorage.
 * Copy each `varg.*` key into Rust once, then stop reading localStorage.
 * The WebView's copy is left in place as a backup; nothing reads it again.
 */
async function importWebViewStorage(): Promise<void> {
  if (cache.has(IMPORTED) || typeof localStorage === "undefined") return;
  // `local()` is off from here on; read the WebView's copy directly.
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    // The Drizzle-era backup of the pre-SQLite blob stays where it is.
    if (key === null || !key.startsWith("varg.") || key.endsWith(".imported") || cache.has(key)) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    await invoke("kv_set", { key, value });
    cache.set(key, value);
  }
  await invoke("kv_set", { key: IMPORTED, value: new Date().toISOString() });
  cache.set(IMPORTED, "1");
}

export function kvGet(key: string): string | null {
  const ls = local();
  if (ls) return ls.getItem(key);
  return cache.get(key) ?? null;
}

export function kvSet(key: string, value: string): void {
  const ls = local();
  if (ls) {
    ls.setItem(key, value);
    return;
  }
  cache.set(key, value);
  enqueue({ key, value });
}

export function kvRemove(key: string): void {
  const ls = local();
  if (ls) {
    ls.removeItem(key);
    return;
  }
  cache.delete(key);
  enqueue({ key, value: null });
}

/* ------------------------------ Write queue ------------------------------- */

interface Write {
  key: string;
  value: string | null;
}

const pending: Write[] = [];
let running = false;
let failure: string | null = null;
let attempts = 0;
const listeners = new Set<() => void>();

function setFailure(f: string | null): void {
  failure = f;
  for (const l of listeners) l();
}

function enqueue(w: Write): void {
  if (!rust) return;
  pending.push(w);
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let w = pending[0]; w !== undefined; w = pending[0]) {
      if (w.value === null) await invoke("kv_remove", { key: w.key });
      else await invoke("kv_set", { key: w.key, value: w.value });
      pending.shift();
    }
    attempts = 0;
    if (failure !== null) setFailure(null);
  } catch (e) {
    attempts++;
    setFailure(`Setting not saved: ${errorText(e)}`);
    setTimeout(() => { void drain(); }, Math.min(30_000, 2_000 * attempts));
  } finally {
    running = false;
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** A settings write that has not reached the store yet, with why. */
export function useKvFailure(): string | null {
  return useSyncExternalStore(subscribe, () => failure);
}
