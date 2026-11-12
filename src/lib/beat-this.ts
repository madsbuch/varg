/**
 * Beats and downbeats from the neural beat model, computed off the UI
 * thread. The model and its spectrogram run in a Web Worker
 * (beat-worker.ts → beat-model.ts); this is the app's side of it.
 *
 * One worker for the app's life: the model loads once in it. The audio is
 * copied over (the caller's buffer stays usable) and the times come back.
 */
import type { BeatReply, BeatRequest } from "./beat-worker";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: { beats: number[]; downbeats: number[] }) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./beat-worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<BeatReply>) => {
    const r = e.data;
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if ("error" in r) p.reject(new Error(r.error));
    else p.resolve({ beats: r.beats, downbeats: r.downbeats });
  };
  // A worker that cannot load or crashes fails every request loudly, and
  // the next request starts a fresh one.
  w.onerror = (e) => {
    const err = new Error(`beat worker: ${e.message || "failed to load"}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** Beat and downbeat times (s) of 22050 Hz mono audio, from the worker. */
export function beatThis(mono: Float32Array): Promise<{ beats: number[]; downbeats: number[] }> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    // A copy of just this stretch, transferred: no copy of the whole track.
    const copy = mono.slice();
    const msg: BeatRequest = { id, mono: copy };
    getWorker().postMessage(msg, [copy.buffer]);
  });
}
