/**
 * Natural-sounding spoken cues through kie.ai, with the same key as the
 * battle tracks: a calm voice for yoga, a firm one for interval workouts.
 *
 * Every line the guided player can speak ("First: Childs Pose", "Next:
 * Push-up") is known in advance — workouts are code, and the lines are
 * derived from the very steps the player runs — so each is generated once
 * with the owner's kie.ai key, cached in IndexedDB, and played offline from
 * then on. Lines are keyed by voice, model and text: changing the voice or
 * a pose name simply makes the new lines "missing" until generated.
 *
 * Playback goes through the shared AudioContext, so the music ducks under
 * a line exactly as it does under a beep. A line that has not been
 * generated falls back to the phone's own voice, and the player says so.
 */
import { seedExercises, seedTemplates } from "./seed";
import { errorText } from "./http";
import { loadMusicSettings } from "./music";
import { audioResults, createTask, download, getTask } from "./kie";
import { duckMusic, getAudioContext } from "./beep";
import type { Side } from "../types";
import { buildSteps, configForTemplate } from "./wod";
import type { Step, VoiceRole } from "./wod";

const GEMINI_MODEL = "google/gemini-3-1-flash-tts";
/**
 * kie.ai's text-to-speech models. Gemini is the default: kie's ElevenLabs
 * jobs were accepted and then failed server-side ("Internal Error") for
 * every voice in November 2026, while Gemini generated cleanly with the
 * same key. ElevenLabs stays selectable for when kie fixes it.
 */
export const VOICE_MODELS = [
  { id: GEMINI_MODEL, label: "Google Gemini 3.1 Flash" },
  { id: "elevenlabs/text-to-speech-multilingual-v2", label: "ElevenLabs Multilingual v2" },
  { id: "elevenlabs/text-to-speech-turbo-2-5", label: "ElevenLabs Turbo 2.5 — faster, cheaper" },
];
const SETTINGS_KEY = "varg.voice.kie.v1";
const DEFAULT_VOICE_MODEL = GEMINI_MODEL;

/** Gemini's voices, with Google's one-word character and the voice's register. */
export const GEMINI_VOICES: KieVoice[] = [
  ["Achernar", "Soft · female"], ["Achird", "Friendly · male"], ["Algenib", "Gravelly · male"],
  ["Algieba", "Smooth · male"], ["Alnilam", "Firm · male"], ["Aoede", "Breezy · female"],
  ["Autonoe", "Bright · female"], ["Callirrhoe", "Easy-going · female"], ["Charon", "Informative · male"],
  ["Despina", "Smooth · female"], ["Enceladus", "Breathy · male"], ["Erinome", "Clear · female"],
  ["Fenrir", "Excitable · male"], ["Gacrux", "Mature · female"], ["Iapetus", "Clear · male"],
  ["Kore", "Firm · female"], ["Laomedeia", "Upbeat · female"], ["Leda", "Youthful · female"],
  ["Orus", "Firm · male"], ["Puck", "Upbeat · male"], ["Pulcherrima", "Forward · female"],
  ["Rasalgethi", "Informative · male"], ["Sadachbia", "Lively · male"], ["Sadaltager", "Knowledgeable · male"],
  ["Schedar", "Even · male"], ["Sulafat", "Warm · female"], ["Umbriel", "Easy-going · male"],
  ["Vindemiatrix", "Gentle · female"], ["Zephyr", "Bright · female"], ["Zubenelgenubi", "Casual · male"],
].map(([name, description]) => ({ voiceId: name ?? "", name: name ?? "", description: description ?? "" }));

export interface KieVoice {
  voiceId: string;
  name: string;
  description: string;
}

/**
 * The ElevenLabs voices kie.ai offers (the same list for both models), from
 * kie's API reference. Each has a free sample at previewUrl(), so choosing
 * one costs nothing.
 */
export const KIE_VOICES: KieVoice[] = [
  { voiceId: "EkK5I93UQWFDigLMpZcX", name: "James", description: "Husky, Engaging and Bold" },
  { voiceId: "Z3R5wn05IrDiVCyEkUrK", name: "Arabella", description: "Mysterious and Emotive" },
  { voiceId: "NNl6r8mD7vthiJatiJt1", name: "Bradford", description: "Expressive and Articulate" },
  { voiceId: "YOq2y2Up4RgXP2HyXjE5", name: "Xavier", description: "Dominating, Metallic Announcer" },
  { voiceId: "B8gJV1IhpuegLxdpXFOE", name: "Kuon", description: "Cheerful, Clear and Steady" },
  { voiceId: "2zRM7PkgwBPiau2jvVXc", name: "Monika Sogam", description: "Deep and Natural" },
  { voiceId: "1SM7GgM6IMuvQlz2BwM3", name: "Mark", description: "Casual, Relaxed and Light" },
  { voiceId: "5l5f8iK3YPeGga21rQIX", name: "Adeline", description: "Feminine and Conversational" },
  { voiceId: "scOwDtmlUjD3prqpp97I", name: "Sam", description: "Support Agent" },
  { voiceId: "NOpBlnGInO9m6vDvFkFC", name: "Spuds Oxley", description: "Wise and Approachable" },
  { voiceId: "BZgkqPqms7Kj9ulSkVzn", name: "Eve", description: "Authentic, Energetic and Happy" },
  { voiceId: "wo6udizrrtpIxWGp2qJk", name: "Northern Terry", description: "" },
  { voiceId: "gU0LNdkMOQCOrPrwtbee", name: "British Football Announcer", description: "" },
  { voiceId: "DGzg6RaUqxGRTHSBjfgF", name: "Brock", description: "Commanding and Loud Sergeant" },
  { voiceId: "x70vRnQBMBu4FAYhjJbO", name: "Nathan", description: "Virtual Radio Host" },
  { voiceId: "Sm1seazb4gs7RSlUVw7c", name: "Anika", description: "Animated, Friendly and Engaging" },
  { voiceId: "P1bg08DkjqiVEzOn76yG", name: "Viraj", description: "Rich and Soft" },
  { voiceId: "qDuRKMlYmrm8trt5QyBn", name: "Taksh", description: "Calm, Serious and Smooth" },
  { voiceId: "qXpMhyvQqiRxWQs4qSSB", name: "Horatius", description: "Energetic Character Voice" },
  { voiceId: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", description: "Energetic, Social Media Creator" },
  { voiceId: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", description: "Husky Trickster" },
  { voiceId: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", description: "Enthusiast, Quirky Attitude" },
  { voiceId: "kPzsL2i3teMYv0FxEYQ6", name: "Brittney", description: "Social Media Voice - Fun, Youthful & Informative" },
  { voiceId: "UgBBYS2sOqTuMpoF3BR0", name: "Mark", description: "Natural Conversations" },
  { voiceId: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", description: "Professional, Bright, Warm" },
  { voiceId: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "Deep, Resonant and Comforting" },
  { voiceId: "uYXf8XasLslADfZ2MB4u", name: "Hope", description: "Bubbly, Gossipy and Girly" },
  { voiceId: "gs0tAILXbY5DNrJrsM6F", name: "Jeff", description: "Classy, Resonating and Strong" },
  { voiceId: "DTKMou8ccj1ZaWGBiotd", name: "Jamahal", description: "Young, Vibrant, and Natural" },
  { voiceId: "vBKc2FfBKJfcZNyEt1n6", name: "Finn", description: "Youthful, Eager and Energetic" },
  { voiceId: "DYkrAHD8iwork3YSUBbs", name: "Tom", description: "Conversations & Books" },
  { voiceId: "56AoDkrOh6qfVPDXZ7Pt", name: "Cassidy", description: "Crisp, Direct and Clear" },
  { voiceId: "eR40ATw9ArzDf9h3v7t7", name: "Addison 2.0", description: "Australian Audiobook & Podcast" },
  { voiceId: "g6xIsTj2HwM6VR4iXFCw", name: "Jessica Anne Bogart", description: "Chatty and Friendly" },
  { voiceId: "lcMyyd2HUfFzxdCaC4Ta", name: "Lucy", description: "Fresh & Casual" },
  { voiceId: "6aDn1KB0hjpdcocrUkmq", name: "Tiffany", description: "Natural and Welcoming" },
  { voiceId: "Sq93GQT4X1lKDXsQcixO", name: "Felix", description: "Warm, Positive & Contemporary RP" },
  { voiceId: "flHkNRp1BlvT73UL6gyz", name: "Jessica Anne Bogart", description: "Eloquent Villain" },
  { voiceId: "9yzdeviXkFddZ4Oz8Mok", name: "Lutz", description: "Chuckling, Giggly and Cheerful" },
  { voiceId: "pPdl9cQBQq4p6mRkZy2Z", name: "Emma", description: "Adorable and Upbeat" },
  { voiceId: "zYcjlYFOd3taleS0gkk3", name: "Edward", description: "Loud, Confident and Cocky" },
  { voiceId: "nzeAacJi50IvxcyDnMXa", name: "Marshal", description: "Friendly, Funny Professor" },
  { voiceId: "ruirxsoakN0GWmGNIo04", name: "John Morgan", description: "Gritty, Rugged Cowboy" },
  { voiceId: "TC0Zp7WVFzhA8zpTlRqV", name: "Aria", description: "Sultry Villain" },
  { voiceId: "ljo9gAlSqKOvF6D8sOsX", name: "Viking Bjorn", description: "Epic Medieval Raider" },
  { voiceId: "PPzYpIqttlTYA83688JI", name: "Pirate Marshal", description: "" },
  { voiceId: "8JVbfL6oEdmuxKn5DK2C", name: "Johnny Kid", description: "Serious and Calm Narrator" },
  { voiceId: "iCrDUkL56s3C8sCRl7wb", name: "Hope", description: "Poetic, Romantic and Captivating" },
  { voiceId: "wJqPPQ618aTW29mptyoc", name: "Ana Rita", description: "Smooth, Expressive and Bright" },
  { voiceId: "EiNlNiXeDU1pqqOPrYMO", name: "John Doe", description: "Deep" },
  { voiceId: "4YYIPFl9wE5c4L2eu2Gb", name: "Burt Reynolds\u2122", description: "Deep, Smooth and Clear" },
  { voiceId: "6F5Zhi321D3Oq7v1oNT4", name: "Hank", description: "Deep and Engaging Narrator" },
  { voiceId: "YXpFCvM1S3JbWEJhoskW", name: "Wyatt", description: "Wise Rustic Cowboy" },
  { voiceId: "LG95yZDEHg6fCZdQjLqj", name: "Phil", description: "Explosive, Passionate Announcer" },
  { voiceId: "CeNX9CMwmxDxUF5Q2Inm", name: "Johnny Dynamite", description: "Vintage Radio DJ" },
  { voiceId: "aD6riP1btT197c6dACmy", name: "Rachel M", description: "Pro British Radio Presenter" },
  { voiceId: "mtrellq69YZsNwzUSyXh", name: "Rex Thunder", description: "Deep N Tough" },
  { voiceId: "dHd5gvgSOzSfduK4CvEg", name: "Ed", description: "Late Night Announcer" },
  { voiceId: "eVItLK1UvXctxuaRV2Oq", name: "Jean", description: "Alluring and Playful Femme Fatale" },
  { voiceId: "esy0r39YPLQjOczyOib8", name: "Britney", description: "Calm and Calculative Villain" },
  { voiceId: "Tsns2HvNFKfGiNjllgqo", name: "Sven", description: "Emotional and Nice" },
  { voiceId: "1U02n4nD6AdIZ9CjF053", name: "Viraj", description: "Smooth and Gentle" },
  { voiceId: "AeRdCCKzvd23BpJoofzx", name: "Nathaniel", description: "Engaging, British and Calm" },
  { voiceId: "LruHrtVF6PSyGItzMNHS", name: "Benjamin", description: "Deep, Warm, Calming" },
  { voiceId: "1wGbFxmAM3Fgw63G1zZJ", name: "Allison", description: "Calm, Soothing and Meditative" },
  { voiceId: "hqfrgApggtO1785R4Fsn", name: "Theodore HQ", description: "Serene and Grounded" },
  { voiceId: "MJ0RnG71ty4LH3dvNfSd", name: "Leon", description: "Soothing and Grounded" },
];

/**
 * Defaults per role and model. Yoga: a calm female voice — ElevenLabs
 * Allison ("calm, soothing and meditative"), Gemini Vindemiatrix
 * ("gentle"). Workouts: a firm male one — ElevenLabs Brock ("commanding
 * and loud sergeant"), Gemini Alnilam ("firm").
 */
const DEFAULTS: Record<VoiceRole, { eleven: string; gemini: string }> = {
  yoga: { eleven: "1wGbFxmAM3Fgw63G1zZJ", gemini: "Vindemiatrix" },
  workout: { eleven: "DGzg6RaUqxGRTHSBjfgF", gemini: "Alnilam" },
};


export function isGemini(model: string): boolean {
  return model.startsWith("google/");
}

/** The voices a model offers, and its default for a role. */
export function voicesFor(model: string, role: VoiceRole = "yoga"): { voices: KieVoice[]; fallback: string } {
  return isGemini(model)
    ? { voices: GEMINI_VOICES, fallback: DEFAULTS[role].gemini }
    : { voices: KIE_VOICES, fallback: DEFAULTS[role].eleven };
}

/** Generate one line without caching it — Gemini has no free samples. */
export function previewLine(s: VoiceSettings, role: VoiceRole, text: string): Promise<Blob> {
  return synthesize(s, role, text);
}

export function previewUrl(voiceId: string): string {
  return `https://static.aiquickdraw.com/elevenlabs/voice/${voiceId}.mp3`;
}

export interface VoiceSettings {
  model: string;
  /** The yoga voice. */
  voiceId: string;
  /** The interval-workout voice. */
  workoutVoiceId: string;
}

export function voiceIdFor(s: VoiceSettings, role: VoiceRole): string {
  return role === "yoga" ? s.voiceId : s.workoutVoiceId;
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<VoiceSettings>;
      const model = p.model && VOICE_MODELS.some((m) => m.id === p.model) ? p.model : DEFAULT_VOICE_MODEL;
      const pick = (id: string | undefined, role: VoiceRole) => {
        const { voices, fallback } = voicesFor(model, role);
        return id && voices.some((v) => v.voiceId === id) ? id : fallback;
      };
      return { model, voiceId: pick(p.voiceId, "yoga"), workoutVoiceId: pick(p.workoutVoiceId, "workout") };
    }
  } catch {
    // fall through to defaults
  }
  return { model: DEFAULT_VOICE_MODEL, voiceId: DEFAULTS.yoga.gemini, workoutVoiceId: DEFAULTS.workout.gemini };
}

export function saveVoiceSettings(s: VoiceSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** The voice needs only the shared kie.ai key; the voice itself has a default. */
export function voiceConfigured(): boolean {
  return loadMusicSettings().apiKey.trim() !== "";
}

/* ------------------------------ The lines -------------------------------- */

/** How a pose name should sound: "Warrior II" is "Warrior two", not "Warrior eye eye". */
export function spokenName(name: string): string {
  return name
    .replace(/\bII\b/g, "two")
    .replace(/\bI\b/g, "one")
    .replace(/'/g, "");
}

export function poseLine(name: string, side: Side | undefined, prefix: "First" | "Next" | "" = ""): string {
  return `${prefix ? `${prefix}: ` : ""}${spokenName(name)}${side ? `, ${side} side` : ""}`;
}

/**
 * What the player says on entering a step: the first exercise during the
 * lead-in, the next one at the start of every rest (in a flow, the move
 * between poses). Nothing during work — the beep starts it, and a hold is
 * for holding.
 */
export function cueLine(step: Step): string {
  if (!step.exercise) return "";
  if (step.kind === "ready") return poseLine(step.exercise.name, step.side, "First");
  if (step.kind === "rest") return poseLine(step.exercise.name, step.side, "Next");
  return "";
}

export interface VoiceLine {
  role: VoiceRole;
  text: string;
}

/**
 * Every line any built-in guided workout can speak, with its voice. Built
 * by expanding each template exactly as the player does, so the set is the
 * player's own cues and nothing else.
 */
export function allVoiceLines(): VoiceLine[] {
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: VoiceLine[] = [];
  for (const t of seedTemplates()) {
    const cfg = configForTemplate(t, exById);
    if (typeof cfg === "string" || !cfg.voice) continue;
    for (const step of buildSteps(cfg)) {
      const text = cueLine(step);
      const id = `${cfg.voice}|${text}`;
      if (!text || seen.has(id)) continue;
      seen.add(id);
      out.push({ role: cfg.voice, text });
    }
  }
  return out;
}

/* ------------------------------ The cache -------------------------------- */

const DB_NAME = "varg-voice";
const STORE = "clips";

interface Clip {
  key: string;
  blob: Blob;
}

const clipKey = (s: VoiceSettings, role: VoiceRole, text: string) => `${voiceIdFor(s, role)}|${s.model}|${text}`;

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

/** How many of the given lines are generated for the current voices. */
export async function countReady(lines: VoiceLine[] = allVoiceLines()): Promise<number> {
  const s = loadVoiceSettings();
  let n = 0;
  for (const line of lines) if (await getClip(clipKey(s, line.role, line.text))) n++;
  return n;
}

/* ------------------------------ Generation ------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One line, as a kie.ai job: submit, poll until done, download the clip. */
/** How each voice is directed: a calm teacher, a firm drill instructor. */
const DIRECTION: Record<VoiceRole, {
  scene: string; context: string; profile: string; style: string; stability: number; speed: number;
}> = {
  yoga: {
    scene: "A quiet yoga studio.",
    context: "A yoga class. Calm, warm guidance between poses.",
    profile: "A calm, warm yoga teacher",
    style: "Empathetic",
    stability: 0.6,
    speed: 0.95,
  },
  workout: {
    scene: "A training hall during a hard interval circuit.",
    context: "A military-style workout. Short, clear, energetic calls between stations.",
    profile: "A firm, motivating drill instructor",
    style: "Promo/Hype",
    stability: 0.5,
    speed: 1.05,
  },
};

async function synthesize(s: VoiceSettings, role: VoiceRole, text: string): Promise<Blob> {
  const voice = voiceIdFor(s, role);
  const d = DIRECTION[role];
  const apiKey = loadMusicSettings().apiKey.trim();
  if (!apiKey) throw new Error("No kie.ai API key — add it in Settings.");
  const taskId = await createTask(
    apiKey,
    s.model,
    isGemini(s.model)
      ? {
          // Gemini speaks a scripted "dialogue": one speaker, one line,
          // directed for the role.
          temperature: 1,
          scene: d.scene,
          sample_context: d.context,
          speakers: [{
            speaker_id: "Speaker 1",
            voice_name: voice,
            audio_profile: d.profile,
            accent: "British (RP)",
            style: d.style,
            pace: "Natural",
          }],
          dialogue_turns: [{ speaker_id: "Speaker 1", text }],
        }
      : {
          text,
          voice,
          stability: d.stability,
          similarity_boost: 0.75,
          speed: d.speed,
        },
  );
  for (let i = 0; i < 60; i++) {
    await sleep(i === 0 ? 1500 : 2000);
    const info = await getTask(apiKey, taskId);
    if (info.state === "fail") throw new Error(`kie.ai failed the line: ${info.failMsg || "no reason given"}`);
    if (info.state !== "success") continue;
    const url = audioResults(info.result)[0]?.url;
    if (!url) throw new Error("kie.ai finished the line but returned no audio URL.");
    const blob = await download(url);
    if (blob.size < 500) throw new Error(`kie.ai returned an empty clip for "${text}".`);
    return blob;
  }
  throw new Error(`kie.ai took over two minutes on "${text}" — try again later.`);
}

let running: Promise<void> | null = null;

/** Progress of any generation run, wherever it was started from. */
type ProgressListener = (ready: number, total: number) => void;
const listeners = new Set<ProgressListener>();
export function onVoiceProgress(fn: ProgressListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Generate every missing line for the current voice. Stops at the first
 * error and throws it — a half-generated set is fine (the rest falls back
 * to the phone voice, visibly), a hidden failure is not.
 */
export function ensureVoiceClips(onProgress?: (ready: number, total: number) => void): Promise<void> {
  if (running) return running;
  running = (async () => {
    // Loud, not a quiet no-op: a Generate button that does nothing is
    // indistinguishable from one that is broken. App start catches this.
    if (!voiceConfigured()) throw new Error("No kie.ai API key saved — enter it in Settings and save.");
    const s = loadVoiceSettings();
    const lines = allVoiceLines();
    let ready = 0;
    for (const line of lines) {
      const key = clipKey(s, line.role, line.text);
      if (!(await getClip(key))) {
        let blob: Blob;
        try {
          blob = await synthesize(s, line.role, line.text);
        } catch (e) {
          throw new Error(`Stopped at "${line.text}": ${errorText(e)}`);
        }
        await withStore("readwrite", (st) => st.put({ key, blob } satisfies Clip));
      }
      ready++;
      onProgress?.(ready, lines.length);
      for (const fn of listeners) fn(ready, lines.length);
    }
  })().finally(() => { running = null; });
  return running;
}

/* ------------------------------- Playback -------------------------------- */

/**
 * Decode a workout's lines into the shared AudioContext before it starts,
 * so each cue plays the instant its step begins. Returns the lines that have
 * no clip — the player shows that the phone voice will stand in.
 */
export async function prepareClips(role: VoiceRole, lines: string[]): Promise<{ buffers: Map<string, AudioBuffer>; missing: string[] }> {
  const buffers = new Map<string, AudioBuffer>();
  const missing: string[] = [];
  const s = loadVoiceSettings();
  const ctx = getAudioContext();
  if (!ctx) return { buffers, missing: lines };
  for (const line of lines) {
    try {
      const clip = await getClip(clipKey(s, role, line));
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
