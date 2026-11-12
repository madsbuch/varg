import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { aggregate, chunkStarts, postprocess } from "../src/lib/beat-model";
import { logMelSpect, N_MELS } from "../src/lib/melspec";

/**
 * The beat model's input and output handling against the Python package it
 * was trained with (beat_this 1.1.0): fixtures/beat-this-ref.json. A drift
 * here is the network reading the wrong picture, so it is checked value by
 * value.
 */
const ref = JSON.parse(readFileSync(new URL("./fixtures/beat-this-ref.json", import.meta.url), "utf8")) as {
  clip_int16_b64: string;
  clip_spect: number[][];
  beat_logits: number[];
  downbeat_logits: number[];
  beats: number[];
  downbeats: number[];
};

describe("beat model input: log-mel spectrogram", () => {
  test("matches torchaudio frame by frame", () => {
    const bytes = Buffer.from(ref.clip_int16_b64, "base64");
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    const mono = Float32Array.from(pcm, (v) => v / 32768);
    const { data, frames } = logMelSpect(mono);
    expect(frames).toBe(ref.clip_spect.length);
    let worst = 0;
    ref.clip_spect.forEach((row, t) => {
      row.forEach((v, m) => { worst = Math.max(worst, Math.abs(v - (data[t * N_MELS + m] ?? 0))); });
    });
    // Rounded to 4 decimals in the fixture.
    expect(worst).toBeLessThan(1e-3);
  });
});

describe("beat model output: chunks and peaks", () => {
  test("chunk starts match split_piece", () => {
    expect(chunkStarts(3001)).toEqual([-6, 1482, 1507]);
    expect(chunkStarts(6001)).toEqual([-6, 1482, 2970, 4458, 4507]);
    expect(chunkStarts(1200)).toEqual([-6]);
  });

  test("stitching keeps the first chunk in overlaps and drops the borders", () => {
    const size = 1500;
    const a = { beat: new Float32Array(size).fill(1), downbeat: new Float32Array(size).fill(1) };
    const b = { beat: new Float32Array(size).fill(2), downbeat: new Float32Array(size).fill(2) };
    const { beat } = aggregate([a, b], [-6, 1482], 2000, size);
    expect(beat[0]).toBe(1);
    expect(beat[1487]).toBe(1); // a's last kept frame
    expect(beat[1488]).toBe(2);
  });

  test("peak picking gives the Python beats and downbeats", () => {
    const r = postprocess(Float32Array.from(ref.beat_logits), Float32Array.from(ref.downbeat_logits));
    expect(r.beats.length).toBe(ref.beats.length);
    r.beats.forEach((b, i) => { expect(Math.abs(b - (ref.beats[i] ?? 0))).toBeLessThan(1e-6); });
    expect(r.downbeats).toEqual(ref.downbeats);
  });

  test("the reference track's downbeats are its real ones", () => {
    // Synthetic 143.95 BPM, first downbeat 0.42 s: every 4th beat from there.
    const beat = 60 / 143.95;
    ref.downbeats.slice(0, 8).forEach((d, k) => {
      expect(Math.abs(d - (0.42 + 4 * beat * k))).toBeLessThan(0.025);
    });
  });
});
