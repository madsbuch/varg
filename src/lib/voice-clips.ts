/**
 * Natural-sounding spoken cues from ElevenLabs.
 *
 * Every line a flow can speak ("First: Childs Pose", "Warrior two, left
 * side") is known in advance — flows are code — so each is generated once
 * with the owner's API key, cached in IndexedDB, and played offline from
 * then on. Lines are keyed by voice, model and text: changing the voice or
 * a pose name simply makes the new lines "missing" until generated.
 *
 * Playback goes through the shared AudioContext, so the music ducks under
 * a line exactly as it does under a beep. A line that has not been
 * generated falls back to the phone's own voice, and the player says so.
 */
import { seedExercises, seedTemplates } from "./seed";
import { errorText, httpFetch } from "./music";
import { duckMusic, getAudioContext } from "./beep";
import type { Side } from "../types";

export const ELEVEN_BASE = "https://api.elevenlabs.io";
export const ELEVEN_MODELS = ["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5"];
const SETTINGS_KEY = "varg.elevenlabs.v1";

export interface VoiceSettings {
  apiKey: string;
  voiceId: string;
  voiceName: string;
  model: string;
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<VoiceSettings>;
      return {
        apiKey: p.apiKey ?? "",
        voiceId: p.voiceId ?? "",
        voiceName: p.voiceName ?? "",
        model: p.model && ELEVEN_MODELS.includes(p.model) ? p.model : "eleven_multilingual_v2",
      };
    }
  } catch {
    // fall through to defaults
  }
  return { apiKey: "", voiceId: "", voiceName: "", model: "eleven_multilingual_v2" };
}

export function saveVoiceSettings(s: VoiceSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function voiceConfigured(s: VoiceSettings = loadVoiceSettings()): boolean {
  return s.apiKey.trim() !== "" && s.voiceId !== "";
}

/* ------------------------------ The lines -------------------------------- */

/** How a pose name should sound: "Warrior II" is "Warrior two", not "Warrior eye eye". */
export function spokenName(name: string): string {
  return name
    .replace(/\bII\b/g, "two")
    .replace(/\bI\b/g, "one")
    .replace(/'/g, "");
}

export function poseLine(name: string, side: Side | undefined, first = false): string {
  return `${first ? "First: " : ""}${spokenName(name)}${side ? `, ${side} side` : ""}`;
}

/** Every line any built-in flow can speak, in first-use order. */
export function allFlowLines(): string[] {
  const names = new Map(seedExercises().map((e) => [e.id, e.name]));
  const lines = new Set<string>();
  for (const t of seedTemplates()) {
    if (!t.flow) continue;
    t.flow.steps.forEach((st, i) => {
      const name = names.get(st.exerciseId);
      if (!name) return;
      if (i === 0) lines.add(poseLine(name, st.side, true));
      lines.add(poseLine(name, st.side));
    });
  }
  return [...lines];
}

/* ------------------------------ The cache -------------------------------- */

const DB_NAME = "varg-voice";
const STORE = "clips";

interface Clip {
  key: string;
  blob: Blob;
}

const clipKey = (s: VoiceSettings, text: string) => `${s.voiceId}|${s.model}|${text}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error("IndexedDB open failed")); };
  });
}

function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => { resolve(req.result); };
        req.onerror = () => { reject(req.error ?? new Error("IndexedDB request failed")); };
      }),
  );
}

async function getClip(key: string): Promise<Clip | undefined> {
  return withStore("readonly", (s) => s.get(key) as IDBRequest<Clip | undefined>);
}

/** How many of the given lines are generated for the current voice. */
export async function countReady(lines: string[] = allFlowLines()): Promise<number> {
  const s = loadVoiceSettings();
  if (!voiceConfigured(s)) return 0;
  let n = 0;
  for (const line of lines) if (await getClip(clipKey(s, line))) n++;
  return n;
}

/* ----------------------------- ElevenLabs API ---------------------------- */

async function apiError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 200);
  try {
    const j = JSON.parse(body) as { detail?: { message?: string } | string };
    detail = typeof j.detail === "string" ? j.detail : j.detail?.message ?? detail;
  } catch {
    // keep the raw text
  }
  if (res.status === 401) return new Error(`ElevenLabs rejected the API key (401): ${detail}`);
  return new Error(`ElevenLabs refused (HTTP ${String(res.status)}): ${detail || "no detail"}`);
}

export interface ElevenVoice {
  voiceId: string;
  name: string;
  description: string;
}

/** The voices the key can use: its own plus ElevenLabs' defaults. */
export async function listVoices(apiKey: string): Promise<ElevenVoice[]> {
  const out: ElevenVoice[] = [];
  let token: string | null = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ page_size: "100", include_total_count: "false" });
    if (token) q.set("next_page_token", token);
    const res = await httpFetch(`${ELEVEN_BASE}/v2/voices?${q.toString()}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) throw await apiError(res);
    const j = (await res.json()) as {
      voices: { voice_id: string; name?: string; description?: string; labels?: Record<string, string> }[];
      has_more: boolean;
      next_page_token?: string | null;
    };
    for (const v of j.voices) {
      const labels = v.labels ? Object.values(v.labels).join(", ") : "";
      out.push({ voiceId: v.voice_id, name: v.name ?? v.voice_id, description: labels || (v.description ?? "") });
    }
    if (!j.has_more || !j.next_page_token) break;
    token = j.next_page_token;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function synthesize(s: VoiceSettings, text: string): Promise<Blob> {
  const res = await httpFetch(
    `${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(s.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": s.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: s.model,
        // Calm, even instruction: a touch slower than conversation.
        voice_settings: { stability: 0.6, similarity_boost: 0.75, speed: 0.95 },
      }),
    },
  );
  if (!res.ok) throw await apiError(res);
  const blob = await res.blob();
  if (blob.size < 500) throw new Error(`ElevenLabs returned an empty clip for "${text}".`);
  return blob;
}

/** Synthesize a single line without caching it — the Settings preview. */
export async function previewLine(s: VoiceSettings, text: string): Promise<Blob> {
  return synthesize(s, text);
}

let running: Promise<void> | null = null;

/**
 * Generate every missing line for the current voice. Stops at the first
 * error and throws it — a half-generated set is fine (the rest falls back
 * to the phone voice, visibly), a hidden failure is not.
 */
export function ensureVoiceClips(onProgress?: (ready: number, total: number) => void): Promise<void> {
  if (running) return running;
  running = (async () => {
    const s = loadVoiceSettings();
    if (!voiceConfigured(s)) return;
    const lines = allFlowLines();
    let ready = 0;
    for (const line of lines) {
      const key = clipKey(s, line);
      if (!(await getClip(key))) {
        let blob: Blob;
        try {
          blob = await synthesize(s, line);
        } catch (e) {
          throw new Error(`Stopped at "${line}": ${errorText(e)}`);
        }
        await withStore("readwrite", (st) => st.put({ key, blob } satisfies Clip));
      }
      ready++;
      onProgress?.(ready, lines.length);
    }
  })().finally(() => { running = null; });
  return running;
}

/* ------------------------------- Playback -------------------------------- */

/**
 * Decode a flow's lines into the shared AudioContext before it starts, so
 * each cue plays the instant its pose begins. Returns the lines that have
 * no clip — the player shows that the phone voice will stand in.
 */
export async function prepareClips(lines: string[]): Promise<{ buffers: Map<string, AudioBuffer>; missing: string[] }> {
  const buffers = new Map<string, AudioBuffer>();
  const missing: string[] = [];
  const s = loadVoiceSettings();
  const ctx = getAudioContext();
  if (!voiceConfigured(s) || !ctx) return { buffers, missing: lines };
  for (const line of lines) {
    try {
      const clip = await getClip(clipKey(s, line));
      if (!clip) {
        missing.push(line);
        continue;
      }
      buffers.set(line, await ctx.decodeAudioData(await clip.blob.arrayBuffer()));
    } catch {
      missing.push(line);
    }
  }
  return { buffers, missing };
}

/** Play a decoded line now. Returns false if there is no running context. */
export function playClip(buffer: AudioBuffer): boolean {
  const ctx = getAudioContext();
  if (ctx?.state !== "running") return false;
  duckMusic(buffer.duration + 0.4);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 1;
  src.buffer = buffer;
  src.connect(gain).connect(ctx.destination);
  src.start();
  return true;
}
