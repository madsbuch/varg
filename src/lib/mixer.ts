/**
 * The adaptive mixer: three Suno tracks, one per intensity, played as one
 * piece of music that follows the ride.
 *
 * Each layer is decoded, its real tempo and first downbeat found
 * (beatgrid.ts), and a loop of whole bars cut from it. Every loop is then
 * played at the rate that makes its bars exactly the workout's tempo, so
 * three tracks Suno composed separately run on one grid. All three play
 * all the time; the mix is only which one is up. A block change crossfades
 * onto its layer over one beat, ending on the beat.
 *
 * The music's position is a function of ride time alone: ride time 0 is
 * bar 1 of every loop. A pause stops the sources and a resume restarts
 * them where ride time says, so nothing a rider does can push the music
 * out of step with the blocks. Changes are booked ahead on the audio
 * clock, where they still happen while the WebView is frozen.
 *
 * Every way this can fail is thrown as a short label for the ride
 * player's red line, never swallowed into flat music.
 */
import type { Intensity } from "../types";
import { analyzeBeats, loopRegion, MAX_JITTER_MS } from "./beatgrid";
import type { BeatGrid } from "./beatgrid";

export interface Layer {
  level: Intensity;
  buffer: AudioBuffer;
  /** Playback rate that brings the track to the workout's tempo. */
  rate: number;
  bars: number;
  grid: BeatGrid;
}

/** Analysis runs on a mono copy at about this rate: plenty for a beat. */
const ANALYSIS_RATE = 22050;
/** How far Suno's tempo may sit from the request before it is refused. */
const MAX_STRETCH = 0.06;
/** Seam fades, against clicks where the loop wraps. */
const SEAM_FADE_S = 0.003;

/** Mono, decimated to about ANALYSIS_RATE, for the beat analysis. */
function analysisMono(buf: AudioBuffer): { mono: Float32Array; rate: number } {
  const step = Math.max(1, Math.round(buf.sampleRate / ANALYSIS_RATE));
  const n = Math.floor(buf.length / step);
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < step; j++) s += data[i * step + j] ?? 0;
      mono[i] = (mono[i] ?? 0) + s / step / buf.numberOfChannels;
    }
  }
  return { mono, rate: buf.sampleRate / step };
}

/**
 * Decode one layer, find its grid and cut its loop. Throws a short label
 * ("Mid: no steady beat") when the track cannot be mixed in time.
 */
export async function prepareLayer(
  ctx: BaseAudioContext,
  blob: Blob,
  level: Intensity,
  name: string,
  bpm: number,
): Promise<Layer> {
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error(`${name}: can't decode`);
  }
  const { mono, rate } = analysisMono(decoded);
  const grid = analyzeBeats(mono, rate, bpm);
  if (grid.jitterMs > MAX_JITTER_MS) throw new Error(`${name}: no steady beat`);
  if (Math.abs(grid.bpm / bpm - 1) > MAX_STRETCH) throw new Error(`${name}: tempo off`);
  const region = loopRegion(grid, decoded.duration);
  if (!region) throw new Error(`${name}: too short`);

  // Copy just the loop, so the rest of the decoded track can be freed.
  const sr = decoded.sampleRate;
  const from = Math.round(region.start * sr);
  const length = Math.round(region.bars * region.barSeconds * sr);
  const buffer = ctx.createBuffer(decoded.numberOfChannels, length, sr);
  const fade = Math.round(SEAM_FADE_S * sr);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const src = decoded.getChannelData(c).subarray(from, from + length);
    const dst = buffer.getChannelData(c);
    dst.set(src);
    for (let i = 0; i < fade; i++) {
      dst[i] = (dst[i] ?? 0) * (i / fade);
      dst[length - 1 - i] = (dst[length - 1 - i] ?? 0) * (i / fade);
    }
  }
  return { level, buffer, rate: bpm / grid.bpm, bars: region.bars, grid };
}

/** How far the music drops under a cue. */
const DUCK_LEVEL = 0.22;
const DUCK_RAMP_S = 0.06;

export class AdaptiveMixer {
  private readonly ctx: AudioContext;
  private readonly layers: Layer[];
  private readonly barSeconds: number;
  private readonly gains = new Map<Intensity, GainNode>();
  private readonly duckGain: GainNode;
  private readonly master: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private origin: number | null = null;

  constructor(ctx: AudioContext, layers: Layer[], bpm: number) {
    this.ctx = ctx;
    this.layers = layers;
    this.barSeconds = 240 / bpm;
    this.master = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master).connect(ctx.destination);
    for (const l of layers) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.duckGain);
      this.gains.set(l.level, g);
    }
  }

  private get beat(): number {
    return this.barSeconds / 4;
  }

  /** Context time of a wall-clock moment. */
  private ctxTime(wall: number): number {
    return this.ctx.currentTime + (wall - Date.now()) / 1000;
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* never started */ }
      s.disconnect();
    }
    this.sources = [];
  }

  /**
   * Follow the ride: `origin` is the wall-clock moment of ride time 0.
   * Restarts the loops only when the origin moved (start, resume) — a
   * block change or a skip leaves them running and only rebooks the mix.
   */
  play(origin: number, paused: boolean): void {
    if (paused) {
      this.stopSources();
      this.origin = null;
      return;
    }
    if (this.origin !== null && Math.abs(this.origin - origin) < 2 && this.sources.length) return;
    this.stopSources();
    this.origin = origin;
    const when = this.ctx.currentTime + 0.05;
    const t = when - this.ctxTime(origin); // ride time at `when`; negative in the lead-in
    for (const l of this.layers) {
      const g = this.gains.get(l.level);
      if (!g) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = l.buffer;
      src.loop = true;
      src.playbackRate.value = l.rate;
      src.connect(g);
      // Bar 1 of every loop is ride time 0: wrap ride time into the loop.
      const loop = l.bars * this.barSeconds;
      const pos = ((t % loop) + loop) % loop;
      src.start(when, pos * l.rate);
      this.sources.push(src);
    }
  }

  /**
   * Put `level` up and book every later change. Every change lands on a
   * beat of the ride's grid: a timed block always ends on one, and after a
   * skip the switch waits for the next beat rather than cut across one.
   * Each is a crossfade over the beat before it.
   */
  mix(level: Intensity | 0, changes: { at: number; level: Intensity | 0 }[]): void {
    const now = this.ctx.currentTime;
    const beat = this.beat;
    const origin = this.origin === null ? null : this.ctxTime(this.origin);
    const snap = (t: number) => (origin === null ? t : origin + Math.ceil((t - origin) / beat - 1e-6) * beat);
    // Hold every gain where it is now: reading first, because cancelling a
    // ramp in flight snaps the value back to where the ramp began.
    const held = new Map<Intensity, number>();
    for (const [l, g] of this.gains) {
      const v = g.gain.value;
      held.set(l, v);
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(v, now);
    }
    // Onto `level` by the next beat (at once while paused: no grid running).
    const first = origin === null ? now + 0.15 : snap(now + 0.05);
    const firstStart = Math.max(now, first - beat);
    for (const [l, g] of this.gains) {
      const target = l === level ? 1 : 0;
      if (Math.abs((held.get(l) ?? 0) - target) < 1e-3) continue;
      g.gain.setValueAtTime(held.get(l) ?? 0, firstStart);
      g.gain.linearRampToValueAtTime(target, first);
    }
    if (origin === null) return;
    let prev = level;
    let free = first;
    for (const c of changes) {
      if (c.level === prev) continue;
      const at = snap(Math.max(this.ctxTime(c.at), free + beat + 0.01));
      const start = at - beat;
      for (const [l, g] of this.gains) {
        const before = l === prev ? 1 : 0, after = l === c.level ? 1 : 0;
        if (before === after) continue;
        g.gain.setValueAtTime(before, start);
        g.gain.linearRampToValueAtTime(after, at);
      }
      free = at;
      prev = c.level;
    }
  }

  /** Pull the music down under a cue for `hold` seconds, then restore. */
  duck(hold: number): void {
    const now = this.ctx.currentTime;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_RAMP_S);
    g.setValueAtTime(DUCK_LEVEL, now + Math.max(DUCK_RAMP_S, hold));
    g.linearRampToValueAtTime(1, now + Math.max(DUCK_RAMP_S, hold) + 0.25);
  }

  setMuted(muted: boolean): void {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.1);
  }

  dispose(): void {
    this.stopSources();
    this.master.disconnect();
  }
}
