/**
 * Generated audio the app paid for, kept for good: battle tracks and songs
 * ("tracks") and spoken cue lines ("clips"). In the app they live in the
 * Rust store's `blobs` table (src-tauri/store) and cross the bridge as
 * base64 (Android's IPC has no raw byte bodies); in a plain browser (vite
 * dev) in IndexedDB.
 *
 * Before this release they lived in the WebView's IndexedDB. Each was paid
 * for, so `importWebViewAudio` copies them into the store once, at boot,
 * before anything checks the cache and composes what it thinks is missing.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "./http";
import { z } from "zod";
import { BlobInfoSchema, parseAs } from "./schema";
import { inTauri, kvGet, kvSet } from "./kv";

export type BlobStore = "tracks" | "clips";

export interface BlobMeta {
  key: string;
  title: string;
  /** Media type, e.g. "audio/mpeg". */
  mime: string;
  /** ISO. */
  createdAt: string;
}

export interface StoredBlob extends BlobMeta {
  blob: Blob;
}

/** The value, or an error naming every way the audio store's answer was off. */
function checked<S extends z.ZodType>(schema: S, raw: unknown, what: string): z.infer<S> {
  const r = parseAs(schema, raw, what);
  if (!r.ok) throw new Error(`Audio store answered unexpectedly: ${r.problems.join("; ")}`);
  return r.value;
}

/** A browser-side file: its description and the Blob itself. */
const BrowserFileSchema = BlobInfoSchema.extend({ store: z.string(), blob: z.instanceof(Blob) });

/* --------------------------------- Rust ---------------------------------- */

async function rustInfo(store: BlobStore, key: string): Promise<BlobMeta | undefined> {
  const raw: unknown = await invoke("blob_info", { storeName: store, key });
  if (raw === null) return undefined;
  return checked(BlobInfoSchema, raw, "blob_info");
}

/** A blob as standard base64, encoded natively (FileReader), not byte by byte. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const comma = typeof url === "string" ? url.indexOf(",") : -1;
      if (typeof url !== "string" || comma < 0) {
        reject(new Error("Audio could not be encoded"));
        return;
      }
      resolve(url.slice(comma + 1));
    };
    reader.onerror = () => { reject(reader.error ?? new Error("Audio could not be read")); };
    reader.readAsDataURL(blob);
  });
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function rustGet(store: BlobStore, key: string): Promise<StoredBlob | undefined> {
  const meta = await rustInfo(store, key);
  if (!meta) return undefined;
  const text: unknown = await invoke("blob_bytes", { storeName: store, key });
  if (typeof text !== "string") throw new Error(`Audio store sent no bytes for ${store}/${key}`);
  return { ...meta, blob: new Blob([fromBase64(text)], { type: meta.mime }) };
}

async function rustPut(store: BlobStore, b: StoredBlob): Promise<void> {
  await invoke("blob_put", {
    file: { store, key: b.key, title: b.title, mime: b.mime, createdAt: b.createdAt, base64: await toBase64(b.blob) },
  });
}

async function rustList(store: BlobStore): Promise<BlobMeta[]> {
  const raw: unknown = await invoke("blob_list", { storeName: store });
  return checked(z.array(BlobInfoSchema), raw, "blob_list");
}

/* ------------------------------- IndexedDB ------------------------------- */
// The browser's store, and the reader for the WebView's old caches.

function idbOpen(name: string, store: string, keyPath: string | string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(store, { keyPath });
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error(`IndexedDB ${name}: open failed`)); };
  });
}

function idbRequest(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => {
      const result: unknown = req.result;
      resolve(result);
    };
    req.onerror = () => { reject(req.error ?? new Error(`IndexedDB ${store}: request failed`)); };
  });
}

const BROWSER_DB = "varg-blobs";
const BROWSER_STORE = "files";

async function browserGet(store: BlobStore, key: string): Promise<StoredBlob | undefined> {
  const db = await idbOpen(BROWSER_DB, BROWSER_STORE, ["store", "key"]);
  const raw = await idbRequest(db, BROWSER_STORE, "readonly", (s) => s.get([store, key]));
  if (raw === undefined) return undefined;
  const f = checked(BrowserFileSchema, raw, `${store}/${key}`);
  return { key: f.key, title: f.title, mime: f.mime, createdAt: f.createdAt, blob: f.blob };
}

async function browserPut(store: BlobStore, b: StoredBlob): Promise<void> {
  const db = await idbOpen(BROWSER_DB, BROWSER_STORE, ["store", "key"]);
  await idbRequest(db, BROWSER_STORE, "readwrite", (s) => s.put({ store, ...b }));
}

async function browserDelete(store: BlobStore, key: string): Promise<void> {
  const db = await idbOpen(BROWSER_DB, BROWSER_STORE, ["store", "key"]);
  await idbRequest(db, BROWSER_STORE, "readwrite", (s) => s.delete([store, key]));
}

async function browserList(store: BlobStore): Promise<BlobMeta[]> {
  const db = await idbOpen(BROWSER_DB, BROWSER_STORE, ["store", "key"]);
  const raw = await idbRequest(db, BROWSER_STORE, "readonly", (s) => s.getAll());
  const all = checked(z.array(BrowserFileSchema), raw, "files");
  return all.filter((f) => f.store === store).map((f) => ({ key: f.key, title: f.title, mime: f.mime, createdAt: f.createdAt }));
}

/* --------------------------------- API ----------------------------------- */

export function blobGet(store: BlobStore, key: string): Promise<StoredBlob | undefined> {
  return inTauri() ? rustGet(store, key) : browserGet(store, key);
}

/** Is it cached? Without moving its bytes. */
export async function blobHas(store: BlobStore, key: string): Promise<boolean> {
  if (inTauri()) return (await rustInfo(store, key)) !== undefined;
  return (await browserGet(store, key)) !== undefined;
}

export function blobPut(store: BlobStore, b: StoredBlob): Promise<void> {
  return inTauri() ? rustPut(store, b) : browserPut(store, b);
}

export async function blobDelete(store: BlobStore, key: string): Promise<void> {
  if (inTauri()) await invoke("blob_delete", { storeName: store, key });
  else await browserDelete(store, key);
}

export function blobList(store: BlobStore): Promise<BlobMeta[]> {
  return inTauri() ? rustList(store) : browserList(store);
}

/* ------------------------- From the WebView, once ------------------------ */

const IMPORTED = "varg.blobs.imported-from-webview.v1";

/** A file in the WebView's old caches (varg-music tracks, varg-voice clips). */
const OldFileSchema = z.object({
  key: z.string().min(1),
  title: z.string().optional(),
  createdAt: z.string().optional(),
  blob: z.instanceof(Blob),
});

/** The WebView's old caches: database, object store, our store. */
const OLD: readonly { db: string; store: string; into: BlobStore }[] = [
  { db: "varg-music", store: "tracks", into: "tracks" },
  { db: "varg-voice", store: "clips", into: "clips" },
];

/*
 * Until the import has finished, a cached track looks missing to the
 * composer, which would pay for it again. So composing waits for it
 * (`audioImported`), and a failure is shown in red with Retry
 * (`useAudioImportProblem`) while the rest of the app works. It used to
 * stop the app at boot instead: one bad audio file locked out the
 * training log.
 */
let importState: { done: boolean; problem: string | null } = { done: !inTauri(), problem: null };
const importListeners = new Set<() => void>();

function setImport(next: { done: boolean; problem: string | null }): void {
  importState = next;
  for (const l of importListeners) l();
}

/** True once the WebView's cached audio is in the store (or there was none). */
export function audioImported(): boolean {
  return importState.done;
}

/** Why the cached audio is not moved yet, or null. */
export function useAudioImportProblem(): string | null {
  return useSyncExternalStore(
    (l) => { importListeners.add(l); return () => { importListeners.delete(l); }; },
    () => importState.problem,
  );
}

/** Copy the WebView's cached audio into the store. Never throws: see above. */
export async function importWebViewAudio(): Promise<void> {
  try {
    await copyWebViewAudio();
    setImport({ done: true, problem: null });
  } catch (e) {
    setImport({ done: false, problem: errorText(e) });
  }
}

/** Copy the audio cached in the WebView's IndexedDB into the Rust store, once. */
async function copyWebViewAudio(): Promise<void> {
  if (!inTauri() || kvGet(IMPORTED) !== null || typeof indexedDB === "undefined") return;
  const names = new Set((await indexedDB.databases()).map((d) => d.name));
  for (const old of OLD) {
    if (!names.has(old.db)) continue;
    const db = await idbOpen(old.db, old.store, "key");
    const raw = await idbRequest(db, old.store, "readonly", (s) => s.getAll());
    db.close();
    // The old caches: tracks carried a title and date, voice clips only a key.
    const oldRows = checked(z.array(OldFileSchema), raw, old.db);
    const rows = oldRows.map((f): StoredBlob => ({
      key: f.key,
      title: f.title ?? "",
      mime: f.blob.type,
      createdAt: f.createdAt ?? new Date(0).toISOString(),
      blob: f.blob,
    }));
    for (const row of rows) {
      if (!(await blobHas(old.into, row.key))) await blobPut(old.into, row);
    }
  }
  kvSet(IMPORTED, new Date().toISOString());
}
