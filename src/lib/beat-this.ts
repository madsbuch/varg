/**
 * Beats and downbeats from a neural network: Beat This! (Foscarin,
 * Schlüter and Widmer, ISMIR 2024; JKU Linz, MIT licence), its small
 * checkpoint exported to ONNX and run on the phone with onnxruntime-web.
 * The model and runtime ship inside the app: no network, no server.
 *
 * Mirrors beat_this.inference.Audio2Beats with the "minimal"
 * postprocessor: the log-mel spectrogram (melspec.ts) is cut into
 * 1500-frame (30 s) chunks overlapping by 6 frames, the model gives a
 * beat and a downbeat logit per 20 ms frame, and a beat is a local maximum
 * within ±70 ms whose logit is above 0. Every downbeat is moved onto its
 * nearest beat. The pure parts are tested against the Python reference
 * (scripts/beat-this.test.ts).
 */
import { FPS, logMelSpect, N_MELS } from "./melspec";

export const CHUNK = 1500;
export const BORDER = 6;

/** Chunk starts for a piece of `frames` frames: split_piece with avoid_short_end. */
export function chunkStarts(frames: number): number[] {
  const starts: number[] = [];
  for (let s = -BORDER; s < frames - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if (frames > CHUNK - 2 * BORDER && starts.length) starts[starts.length - 1] = frames - (CHUNK - BORDER);
  return starts;
}

/** One zero-padded chunk of the spectrogram, CHUNK × N_MELS. */
function chunkAt(spect: Float32Array, frames: number, start: number, size: number): Float32Array {
  const out = new Float32Array(size * N_MELS);
  for (let t = 0; t < size; t++) {
    const src = start + t;
    if (src < 0 || src >= frames) continue;
    out.set(spect.subarray(src * N_MELS, (src + 1) * N_MELS), t * N_MELS);
  }
  return out;
}

/**
 * Stitch per-chunk logits into the piece ("keep_first": earlier chunks
 * win the overlaps), dropping BORDER frames at each chunk edge.
 */
export function aggregate(chunks: { beat: Float32Array; downbeat: Float32Array }[], starts: number[], frames: number, size: number) {
  const beat = new Float32Array(frames).fill(-1000);
  const downbeat = new Float32Array(frames).fill(-1000);
  for (let c = chunks.length - 1; c >= 0; c--) {
    const ch = chunks[c], s = starts[c];
    if (!ch || s === undefined) continue;
    for (let i = BORDER; i < size - BORDER; i++) {
      const t = s + i;
      if (t < 0 || t >= frames) continue;
      beat[t] = ch.beat[i] ?? -1000;
      downbeat[t] = ch.downbeat[i] ?? -1000;
    }
  }
  return { beat, downbeat };
}

/** Peaks: local maxima within ±3 frames (±60 ms) with a positive logit. */
function peakFrames(logits: Float32Array): number[] {
  const out: number[] = [];
  for (let t = 0; t < logits.length; t++) {
    const v = logits[t] ?? -1000;
    if (v <= 0) continue;
    let max = -Infinity;
    for (let j = Math.max(0, t - 3); j <= Math.min(logits.length - 1, t + 3); j++) max = Math.max(max, logits[j] ?? -1000);
    if (v === max) out.push(t);
  }
  // Adjacent peak frames (a plateau) become their mean.
  const merged: number[] = [];
  let p = out[0], c = 1;
  if (p === undefined) return merged;
  for (const q of out.slice(1)) {
    if (q - p <= 1) {
      c++;
      p += (q - p) / c;
    } else {
      merged.push(p);
      p = q;
      c = 1;
    }
  }
  merged.push(p);
  return merged;
}

/** The minimal postprocessor: beat and downbeat times in seconds. */
export function postprocess(beat: Float32Array, downbeat: Float32Array): { beats: number[]; downbeats: number[] } {
  const beats = peakFrames(beat).map((f) => f / FPS);
  const raw = peakFrames(downbeat).map((f) => f / FPS);
  const downbeats = beats.length
    ? [...new Set(raw.map((d) => beats.reduce((best, b) => (Math.abs(b - d) < Math.abs(best - d) ? b : best))))].sort((a, b) => a - b)
    : [];
  return { beats, downbeats };
}

type Ort = typeof import("onnxruntime-web/wasm");
let session: Promise<{ ort: Ort; run: import("onnxruntime-web/wasm").InferenceSession }> | null = null;

/** The model, loaded once: the runtime and weights are bundled assets. */
function loadSession() {
  session ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    const [{ default: modelUrl }, { default: wasmUrl }, { default: mjsUrl }] = await Promise.all([
      import("../assets/beat-this/beat_this_small.onnx?url"),
      import("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url"),
      import("../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url"),
    ]);
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
    // The WebView is not cross-origin isolated: no SharedArrayBuffer, no threads.
    ort.env.wasm.numThreads = 1;
    const bytes = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
    const run = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    return { ort, run };
  })();
  session.catch(() => { session = null; });
  return session;
}

/** Beat and downbeat times (s) of 22050 Hz mono audio. */
export async function beatThis(mono: Float32Array): Promise<{ beats: number[]; downbeats: number[] }> {
  const { data: spect, frames } = logMelSpect(mono);
  const { ort, run } = await loadSession();
  // Always full chunks: the model was exported for 1500 frames, and a short
  // piece is zero-padded like the edges of a long one.
  const size = CHUNK;
  const starts = chunkStarts(frames);
  const chunks: { beat: Float32Array; downbeat: Float32Array }[] = [];
  for (const s of starts) {
    const input = new ort.Tensor("float32", chunkAt(spect, frames, s, size), [1, size, N_MELS]);
    const out = await run.run({ spect: input });
    const b = out["beat"]?.data, d = out["downbeat"]?.data;
    if (!(b instanceof Float32Array) || !(d instanceof Float32Array)) throw new Error("beat model returned no logits");
    chunks.push({ beat: b, downbeat: d });
  }
  const { beat, downbeat } = aggregate(chunks, starts, frames, size);
  return postprocess(beat, downbeat);
}
