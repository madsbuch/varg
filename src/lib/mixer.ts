/**
 * The adaptive mixer: songs from the collection (src/lib/songs.ts), each
 * playing the stretch of the ride it is booked for, as one continuous set.
 *
 * Each song's beats and downbeats are found by a neural network
 * (beat-this.ts), its loudest steady section chosen as a loop of whole
 * bars from a downbeat (beatgrid.ts), played at
 * the rate that makes its bars exactly the song's tempo. A stretch of the
 * ride plays its song with bar 1 of that loop on the stretch's first beat,
 * crossfading DJ-style over the 3-2-1: the song comes in three seconds
 * early under the one before, playing its own lead-up (a peak song's build
 * into its drop) with its low end held back, and drops its kick and bass
 * on the one. Every timed block is
 * whole bars at every song's tempo (smoke test), so changes land on the
 * one even when the tempo changes (a faster peak).
 *
 * Bookings are wall-clock times from the ride clock, scheduled ahead on
 * the audio clock, so songs change on time while the WebView is frozen.
 * A rebook keeps what is already playing as booked: a block change does
 * not restart its own song. A pause stops everything; a resume or a skip
 * books again from the new ride clock.
 *
 * Every way a song can fail is a short label for the player's red line,
 * never off-beat music.
 */
import { BORDER, CHUNK } from "./beat-model";
import { beatThis } from "./beat-this";
import { loopFromBeats, loudestWindow, MAX_STRETCH } from "./beatgrid";
import type { Loop } from "./beatgrid";
import { FPS, SAMPLE_RATE } from "./melspec";
import type { Song } from "./songs";
import { positionAt, scoreVoices, valueAt } from "./score";
import type { Booking, Points, ScoreSong, Voice } from "./score";

/** A song ready to mix: its loop and how to play it. */
export interface SongLoop {
  song: Song;
  buffer: AudioBuffer;
  /** Playback rate that brings the loop's section to the song's tempo. */
  rate: number;
  loop: Loop;
  /**
   * Seconds of the track before the loop kept at the head of the buffer
   * (track time): a crossfade plays the song's real lead-up into bar 1,
   * a peak song's build into its drop, not the loop's end wrapped round.
   */
  pre: number;
  /** Loudness trim: the loop to its intensity's level (LEVEL_DB). */
  trim: number;
}

/**
 * The level (mean dB full scale) each intensity's songs play at. Suno
 * masters close to full scale, and a ride crosses two songs at once: at
 * their own level they clipped (a hot render peaked at 2.2× full scale).
 * Every song is brought to its intensity's level instead, with headroom,
 * a step apart so Accelerate still lifts.
 */
const LEVEL_DB: Record<1 | 2 | 3, number> = { 1: -22, 2: -20.5, 3: -19 };
/** Most a quiet song is raised, and a hot one lowered (dB). */
const TRIM_LIMIT_DB = 12;

/** The limiter's threshold (dB full scale) at the end of the music chain. */
const LIMIT_DB = -6;

/** Track time kept before each loop for the crossfade's lead-up. */
const PRE_ROLL_S = 4;

/** Seam fades, against clicks where the loop wraps. */
const SEAM_FADE_S = 0.003;
/**
 * Longest loop cut per song. A block plays from bar 1, and a 20 s block is
 * 12-13 bars; 16 keeps a dozen decoded songs within a phone's memory.
 */
export const SONG_LOOP_BARS = 16;

/** A song the mixer refuses: a short label for the player, numbers for the log. */
export class LayerError extends Error {
  readonly detail: string;
  constructor(label: string, detail: string) {
    super(label);
    this.detail = detail;
  }
}

async function decode(ctx: BaseAudioContext, blob: Blob, song: Song): Promise<AudioBuffer> {
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new LayerError(`${song.name}: can't decode`, "decodeAudioData refused it");
  }
}

/** Mono at the network's 22050 Hz, by the browser's own resampler. */
async function networkMono(decoded: AudioBuffer): Promise<Float32Array> {
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination); // a stereo source down-mixes to (L + R) / 2
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

/** What the beat model found in a track. */
export interface TrackBeats {
  duration: number;
  /** The stretch of the track the network read, seconds. */
  analysed: [number, number];
  beats: number[];
  downbeats: number[];
  /** The loop the mixer plays, or null and why. */
  loop: Loop | null;
  why: string;
}

/**
 * Run the beat model over a track: its beats and downbeats (beat-this.ts),
 * and the loudest steady section starting on a downbeat as the loop
 * (beatgrid.ts). Seconds of work on a phone, so it runs once per composed
 * track, as soon as it is downloaded (song-loops.ts), and is kept.
 * Throws a LayerError only when the track cannot be decoded or the model
 * cannot run; a track without a steady beat comes back with `loop: null`.
 */
export async function analyzeTrack(ctx: BaseAudioContext, blob: Blob, song: Song): Promise<TrackBeats> {
  const decoded = await decode(ctx, blob, song);
  const mono = await networkMono(decoded);
  const duration = mono.length / SAMPLE_RATE;
  const beatsIn = async (from: number, to: number) => {
    try {
      const a = Math.round(from * SAMPLE_RATE), b = Math.round(to * SAMPLE_RATE);
      const found = await beatThis(mono.subarray(a, b));
      const shift = (t: number) => Math.round((t + a / SAMPLE_RATE) * 1e4) / 1e4;
      return { beats: found.beats.map(shift), downbeats: found.downbeats.map(shift) };
    } catch (e) {
      throw new LayerError(`${song.name}: beat model failed`, e instanceof Error ? e.message : String(e));
    }
  };
  // The network costs seconds per 30 s on a phone. A low or mid song's
  // loop is its loudest steady section, so the network looks at the
  // loudest window first: one model chunk, which holds 16 bars down to
  // 72 BPM, and the whole track only if nothing there is steady. A peak
  // song's loop starts on its drop, which sits where the loud part
  // begins, before that window: it reads the whole track.
  const preferDrop = song.intensity === 3;
  const pick = (f: { beats: number[]; downbeats: number[] }) =>
    loopFromBeats(f.beats, f.downbeats, mono, SAMPLE_RATE, song.bpm, SONG_LOOP_BARS, { preferDrop });
  const window = (CHUNK - 2 * BORDER) / FPS;
  const from = preferDrop ? 0 : loudestWindow(mono, SAMPLE_RATE, window);
  const to = preferDrop ? duration : Math.min(duration, from + window);
  let found = await beatsIn(from, to);
  let analysed: [number, number] = [from, to];
  let result = pick(found);
  if (!result.loop && !preferDrop) {
    found = await beatsIn(0, duration);
    analysed = [0, duration];
    result = pick(found);
  }
  return { duration, analysed, ...found, loop: result.loop, why: result.why };
}

/**
 * Decode a song and cut the loop the beat model chose for it
 * (song-loops.ts). Throws a LayerError when it cannot be mixed in time.
 */
export async function prepareSong(ctx: BaseAudioContext, blob: Blob, song: Song, loop: Loop): Promise<SongLoop> {
  if (Math.abs(loop.bpm / song.bpm - 1) > MAX_STRETCH) {
    throw new LayerError(`${song.name}: tempo off`, `${loop.bpm.toFixed(2)} BPM against ${String(song.bpm)}`);
  }
  const decoded = await decode(ctx, blob, song);

  // Copy the lead-up and the loop, so the rest of the track can be freed.
  const sr = decoded.sampleRate;
  const pre = Math.min(PRE_ROLL_S, loop.start);
  const from = Math.round((loop.start - pre) * sr);
  const head = Math.round(pre * sr);
  const length = Math.min(decoded.length - from, head + Math.round(((loop.bars * 240) / loop.bpm) * sr));
  const buffer = ctx.createBuffer(decoded.numberOfChannels, length, sr);
  const fade = Math.round(SEAM_FADE_S * sr);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const src = decoded.getChannelData(c).subarray(from, from + length);
    const dst = buffer.getChannelData(c);
    dst.set(src);
    // Against clicks: in at the buffer's start, out where the loop wraps.
    for (let i = 0; i < fade; i++) {
      dst[i] = (dst[i] ?? 0) * (i / fade);
      dst[length - 1 - i] = (dst[length - 1 - i] ?? 0) * (i / fade);
    }
  }
  // Its loudness over the loop, to bring it to its intensity's level.
  let sum = 0, count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = head; i < d.length; i++) sum += (d[i] ?? 0) ** 2;
    count += d.length - head;
  }
  const levelDb = 10 * Math.log10(sum / Math.max(1, count) + 1e-12);
  const trimDb = Math.max(-TRIM_LIMIT_DB, Math.min(TRIM_LIMIT_DB, LEVEL_DB[song.intensity] - levelDb));
  return { song, buffer, rate: song.bpm / loop.bpm, loop, pre: head / sr, trim: 10 ** (trimDb / 20) };
}

export type { Booking } from "./score";

/** A song as the score needs it. */
export function scoreSong(s: SongLoop): ScoreSong {
  return { id: s.song.id, bpm: s.song.bpm, rate: s.rate, trim: s.trim, pre: s.pre, duration: s.buffer.duration };
}

interface Nodes {
  voice: Voice;
  src: AudioBufferSourceNode;
  hp: BiquadFilterNode;
  gain: GainNode;
}

/** How far the music drops under a cue. */
const DUCK_LEVEL = 0.22;
const DUCK_RAMP_S = 0.06;

const voiceKey = (v: Voice) => `${v.songId}@${String(v.at)}`;

/**
 * The browser's player of the ride's score (score.ts): each voice a buffer
 * source through a high-pass, its trim and its gain curve, into one bus,
 * the cue duck, the mute and a limiter. The native ride service plays the
 * same score off the same rules; this one plays when there is no service.
 */
export class AdaptiveMixer {
  private readonly ctx: AudioContext;
  private readonly songs = new Map<string, SongLoop>();
  private readonly bus: GainNode;
  private readonly duckGain: GainNode;
  private readonly master: GainNode;
  private nodes = new Map<string, Nodes>();
  private score: Voice[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.bus = ctx.createGain();
    // Last in line, a limiter: whatever two songs add up to in a
    // crossfade, the music never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMIT_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    this.bus.connect(this.duckGain).connect(this.master).connect(limiter).connect(ctx.destination);
  }

  add(song: SongLoop): void {
    this.songs.set(song.song.id, song);
  }

  has(songId: string): boolean {
    return this.songs.has(songId);
  }

  /** Context time of a wall-clock ms. */
  private ctxTime(wall: number): number {
    return this.ctx.currentTime + (wall - Date.now()) / 1000;
  }

  /** Lay a point curve on a param from wall time `from` on. */
  private curve(p: AudioParam, points: Points, from: number): void {
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(valueAt(points, from), Math.max(now, this.ctxTime(from)));
    for (const [t, v] of points) if (t > from) p.linearRampToValueAtTime(v, this.ctxTime(t));
  }

  /**
   * Play these bookings from now on: the score is recomputed from the last
   * one (continuing voices unchanged), and the nodes follow it.
   */
  book(bookings: Booking[], paused: boolean, firstAt?: number): void {
    const now = Date.now();
    const songs = new Map([...this.songs.values()].map((s) => [s.song.id, scoreSong(s)]));
    this.score = scoreVoices(this.score, bookings, songs, now, paused, firstAt);
    this.play(this.score, now);
  }

  /** Bring the nodes in line with a score. */
  private play(score: Voice[], now: number): void {
    const keep = new Map<string, Nodes>();
    for (const v of score) {
      const key = voiceKey(v);
      const had = this.nodes.get(key);
      if (had) {
        if (JSON.stringify(had.voice.gain) !== JSON.stringify(v.gain)) this.curve(had.gain.gain, v.gain, now);
        if (had.voice.stop !== v.stop && v.stop !== null) had.src.stop(Math.max(this.ctx.currentTime, this.ctxTime(v.stop)));
        had.voice = v;
        keep.set(key, had);
        continue;
      }
      const song = this.songs.get(v.songId);
      if (!song) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = song.buffer;
      src.loop = true;
      src.loopStart = v.loopStart;
      src.loopEnd = v.loopEnd;
      src.playbackRate.value = v.rate;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.Q.value = 0.7;
      const trim = this.ctx.createGain();
      trim.gain.value = v.trim;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(trim).connect(gain).connect(this.bus);
      const startWall = Math.max(v.start, now + 20);
      src.start(this.ctxTime(startWall), positionAt(v, startWall));
      if (v.stop !== null) src.stop(this.ctxTime(v.stop));
      this.curve(gain.gain, v.gain, Math.min(startWall, v.gain[0]?.[0] ?? startWall));
      this.curve(hp.frequency, v.hp, Math.min(startWall, v.hp[0]?.[0] ?? startWall));
      src.onended = () => { src.disconnect(); hp.disconnect(); trim.disconnect(); gain.disconnect(); };
      keep.set(key, { voice: v, src, hp, gain });
    }
    for (const [key, n] of this.nodes) {
      if (keep.has(key)) continue;
      try { n.src.stop(); } catch { /* never started */ }
    }
    this.nodes = keep;
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
    this.book([], true);
    this.master.disconnect();
  }
}
