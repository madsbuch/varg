/**
 * The beat model's own thread. The spectrogram and the network are seconds
 * of CPU per song; run on the UI thread they froze the whole interface
 * (measured: a 10 ms timer got a turn every ~93 ms on desktop). Here they
 * run beside it. Requests are answered one at a time, in order.
 */
import { runBeatThis } from "./beat-model";

export interface BeatRequest {
  id: number;
  mono: Float32Array;
}
export type BeatReply =
  | { id: number; beats: number[]; downbeats: number[] }
  | { id: number; error: string };

let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<BeatRequest>) => {
  const { id, mono } = e.data;
  queue = queue.then(async () => {
    let reply: BeatReply;
    try {
      reply = { id, ...(await runBeatThis(mono)) };
    } catch (err) {
      reply = { id, error: err instanceof Error ? err.message : String(err) };
    }
    self.postMessage(reply);
  });
};
