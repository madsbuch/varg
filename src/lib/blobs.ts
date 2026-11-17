/**
 * Generated audio the app paid for, kept for good: battle tracks and songs
 * ("tracks") and spoken cue lines ("clips"). In the app they live in the
 * Rust store's `blobs` table (src-tauri/store) and cross the bridge as raw
 * bytes; in a plain browser (vite dev) in IndexedDB.
 *
 * Before this release they lived in the WebView's IndexedDB. Each was paid
 * for, so `importWebViewAudio` copies them into the store once, at boot,
 * before anything checks the cache and composes what it thinks is missing.
 */
import { invoke } from "@tauri-apps/api/core";
import { Reader } from "./decode";
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

function readMeta(r: Reader, v: unknown, path: string): BlobMeta {
  const f = r.obj(v, path);
  return {
    key: r.str(f.get("key"), `${path}.key`),
    title: r.text(f.get("title"), `${path}.title`),
    mime: r.text(f.get("mime"), `${path}.mime`),
    createdAt: r.text(f.get("createdAt"), `${path}.createdAt`),
  };
}

function checked<T>(r: Reader, value: T): T {
  if (!r.ok()) throw new Error(`Audio store answered unexpectedly: ${r.problems.join("; ")}`);
  return value;
}

/* --------------------------------- Rust ---------------------------------- */

async function rustInfo(store: BlobStore, key: string): Promise<BlobMeta | undefined> {
  const raw: unknown = await invoke("blob_info", { storeName: store, key });
  if (raw === null) return undefined;
  const r = new Reader();
  return checked(r, readMeta(r, raw, "blob_info"));
}

async function rustGet(store: BlobStore, key: string): Promise<StoredBlob | undefined> {
  const meta = await rustInfo(store, key);
  if (!meta) return undefined;
  const bytes: unknown = await invoke("blob_bytes", { storeName: store, key });
  if (!(bytes instanceof ArrayBuffer)) throw new Error(`Audio store sent no bytes for ${store}/${key}`);
  return { ...meta, blob: new Blob([bytes], { type: meta.mime }) };
}

async function rustPut(store: BlobStore, b: StoredBlob): Promise<void> {
  const header = encodeURIComponent(JSON.stringify({ store, key: b.key, title: b.title, mime: b.mime, createdAt: b.createdAt }));
  const bytes = new Uint8Array(await b.blob.arrayBuffer());
  await invoke("blob_put", bytes, { headers: { "x-blob": header } });
}

async function rustList(store: BlobStore): Promise<BlobMeta[]> {
  const raw: unknown = await invoke("blob_list", { storeName: store });
  const r = new Reader();
  return checked(r, r.arr(raw, "blob_list").map((x, i) => readMeta(r, x, `blob_list[${i}]`)));
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

function readStored(r: Reader, v: unknown, path: string): StoredBlob {
  const f = r.obj(v, path);
  const blob = f.get("blob");
  if (!(blob instanceof Blob)) r.fail(`${path}.blob must be a Blob`);
  return { ...readMeta(r, v, path), blob: blob instanceof Blob ? blob : new Blob() };
}

async function browserGet(store: BlobStore, key: string): Promise<StoredBlob | undefined> {
  const db = await idbOpen(BROWSER_DB, BROWSER_STORE, ["store", "key"]);
  const raw = await idbRequest(db, BROWSER_STORE, "readonly", (s) => s.get([store, key]));
  if (raw === undefined) return undefined;
  const r = new Reader();
  return checked(r, readStored(r, raw, `${store}/${key}`));
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
  const r = new Reader();
  const all = r.arr(raw, "files").map((x, i) => {
    const f = r.obj(x, `files[${i}]`);
    return { store: r.text(f.get("store"), `files[${i}].store`), meta: readMeta(r, x, `files[${i}]`) };
  });
  return checked(r, all.filter((x) => x.store === store).map((x) => x.meta));
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

/** The WebView's old caches: database, object store, our store. */
const OLD: readonly { db: string; store: string; into: BlobStore }[] = [
  { db: "varg-music", store: "tracks", into: "tracks" },
  { db: "varg-voice", store: "clips", into: "clips" },
];

/**
 * Copy the audio cached in the WebView's IndexedDB into the Rust store.
 * Runs at boot until it has finished once; throws with the reason (the
 * boot screen shows it with Retry) rather than let a track that was paid
 * for be composed again.
 */
export async function importWebViewAudio(): Promise<void> {
  if (!inTauri() || kvGet(IMPORTED) !== null || typeof indexedDB === "undefined") return;
  const names = new Set((await indexedDB.databases()).map((d) => d.name));
  for (const old of OLD) {
    if (!names.has(old.db)) continue;
    const db = await idbOpen(old.db, old.store, "key");
    const raw = await idbRequest(db, old.store, "readonly", (s) => s.getAll());
    db.close();
    const r = new Reader();
    const rows = r.arr(raw, old.db).map((x, i) => {
      const f = r.obj(x, `${old.db}[${i}]`);
      const blob = f.get("blob");
      if (!(blob instanceof Blob)) r.fail(`${old.db}[${i}].blob must be a Blob`);
      const title = f.get("title");
      const createdAt = f.get("createdAt");
      const row: StoredBlob = {
        key: r.str(f.get("key"), `${old.db}[${i}].key`),
        title: typeof title === "string" ? title : "",
        mime: blob instanceof Blob ? blob.type : "",
        createdAt: typeof createdAt === "string" ? createdAt : new Date(0).toISOString(),
        blob: blob instanceof Blob ? blob : new Blob(),
      };
      return row;
    });
    checked(r, rows);
    for (const row of rows) {
      if (!(await blobHas(old.into, row.key))) await blobPut(old.into, row);
    }
  }
  kvSet(IMPORTED, new Date().toISOString());
}
