/**
 * The adaptive mixer: songs from the collection (src/lib/songs.ts), each
 * playing the stretch of the ride it is booked for, as one continuous set.
 *
 * Each song's beats and downbeats are found by a neural network
 * (beat-this.ts), its loudest steady section chosen as a loop of whole
 * bars from a downbeat (beatgrid.ts), played at
 * the rate that makes its bars exactly the song's tempo. A stretch of the
 * ride plays its song with bar 1 of that loop on the stretch's first beat,
 * crossfading DJ-style: the song comes in two bars early under the one
 * before, its low end held back, and drops its kick and bass on the one. Every timed block is
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

/** A song ready to mix: its loop and how to play it. */
export interface SongLoop {
  song: Song;
  buffer: AudioBuffer;
  /** Playback rate that brings the loop's section to the song's tempo. */
  rate: number;
  loop: Loop;
}

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
  // The network costs seconds per 30 s on a phone. The loop it is after is
  // the loudest steady section, so it looks at the loudest window first:
  // one model chunk, which holds 16 bars down to 72 BPM. Only if nothing
  // there is steady does it read the whole track.
  const window = (CHUNK - 2 * BORDER) / FPS;
  const from = loudestWindow(mono, SAMPLE_RATE, window);
  const to = Math.min(duration, from + window);
  let found = await beatsIn(from, to);
  let analysed: [number, number] = [from, to];
  let result = loopFromBeats(found.beats, found.downbeats, mono, SAMPLE_RATE, song.bpm, SONG_LOOP_BARS);
  if (!result.loop) {
    found = await beatsIn(0, duration);
    analysed = [0, duration];
    result = loopFromBeats(found.beats, found.downbeats, mono, SAMPLE_RATE, song.bpm, SONG_LOOP_BARS);
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

  // Copy just the loop, so the rest of the decoded track can be freed.
  const sr = decoded.sampleRate;
  const from = Math.round(loop.start * sr);
  const length = Math.min(decoded.length - from, Math.round(((loop.bars * 240) / loop.bpm) * sr));
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
  return { song, buffer, rate: song.bpm / loop.bpm, loop };
}

/** A song booked for a stretch of the ride, in wall-clock time. */
export interface Booking {
  songId: string;
  at: number;
  /** Null: ends on kcal, unknowable ahead; rebooked when it ends. */
  until: number | null;
}

interface Playing {
  songId: string;
  at: number;
  until: number | null;
  /** Seconds before `until` its fade-out starts: the next song's crossfade. */
  fadeOut: number;
  src: AudioBufferSourceNode;
  /** Holds the low end back while the song comes in under the one before. */
  hp: BiquadFilterNode;
  gain: GainNode;
}

/** How far the music drops under a cue. */
const DUCK_LEVEL = 0.22;
const DUCK_RAMP_S = 0.06;
/** Fade for anything cut short: a skip, a pause, a stop. */
const CUT_S = 0.06;
/** Bookings this close (ms) are the same booking, rebooked. */
const SAME_MS = 50;
/** Bars the incoming song plays under the outgoing one before its bar 1. */
const XF_BARS = 2;
/**
 * The incoming song's high-pass during the crossfade: its kick and bass
 * wait (so two kicks never clash, even across a tempo change) and drop in
 * on the one, as a DJ swaps the bass.
 */
const HP_HOLD = 300;
const HP_OPEN = 10;
const SWAP_S = 0.03;

/**
 * An equal-power move of `p` from `from` to `to` over [t0, t1], as linear
 * segments (setValueCurveAtTime throws on any overlap with a rebook).
 */
function powerRamp(p: AudioParam, t0: number, t1: number, from: number, to: number): void {
  const n = 8;
  const up = to > from;
  for (let i = 1; i <= n; i++) {
    const x = i / n;
    const shape = up ? Math.sin((x * Math.PI) / 2) : 1 - Math.cos((x * Math.PI) / 2);
    p.linearRampToValueAtTime(from + (to - from) * shape, t0 + (t1 - t0) * x);
  }
}

export class AdaptiveMixer {
  private readonly ctx: AudioContext;
  private readonly songs = new Map<string, SongLoop>();
  private readonly bus: GainNode;
  private readonly duckGain: GainNode;
  private readonly master: GainNode;
  private playing: Playing[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.bus = ctx.createGain();
    this.bus.connect(this.duckGain).connect(this.master).connect(ctx.destination);
  }

  add(song: SongLoop): void {
    this.songs.set(song.song.id, song);
  }

  has(songId: string): boolean {
    return this.songs.has(songId);
  }

  /** Context time of a wall-clock moment. */
  private ctxTime(wall: number): number {
    return this.ctx.currentTime + (wall - Date.now()) / 1000;
  }

  private cut(p: Playing, now: number): void {
    const g = p.gain.gain;
    const v = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(v, now);
    g.linearRampToValueAtTime(0, now + CUT_S);
    p.src.onended = () => { p.src.disconnect(); p.hp.disconnect(); p.gain.disconnect(); };
    p.src.stop(now + CUT_S + 0.01);
  }

  /** Schedule the fade-out into the next song (or the end), from `from` on. */
  private fadeOut(p: Playing, from: number, level: number): void {
    if (p.until === null) return;
    const end = this.ctxTime(p.until);
    const start = Math.max(from, end - p.fadeOut);
    const g = p.gain.gain;
    g.setValueAtTime(level, start);
    powerRamp(g, start, Math.max(start + 0.01, end), level, 0);
    p.src.onended = () => { p.src.disconnect(); p.hp.disconnect(); p.gain.disconnect(); };
    p.src.stop(Math.max(start + 0.02, end + 0.02));
  }

  /**
   * Play these bookings from now on. Bookings already playing or scheduled
   * stay (their end is updated); bookings no longer wanted are cut; new
   * ones are scheduled. Back-to-back bookings crossfade: the incoming song
   * starts XF_BARS bars early, timed so its bar 1 lands on the change,
   * comes in on an equal-power curve with its low end held back, and drops
   * its kick and bass on the one while the outgoing song fades out under
   * it. A booking already under way starts where the ride clock says it
   * would be, so a resume picks up mid-song in time.
   */
  book(bookings: Booking[], paused: boolean): void {
    const now = this.ctx.currentTime;
    if (paused) {
      for (const p of this.playing) this.cut(p, now);
      this.playing = [];
      return;
    }
    const wallNow = Date.now();
    const wanted = bookings.filter((b) => this.songs.has(b.songId) && (b.until === null || b.until > wallNow + 20));
    // How long each booking fades out: the next song's crossfade when one
    // follows straight on, else one beat of its own.
    const fadeOutOf = (b: Booking): number => {
      const next = wanted.find((x) => b.until !== null && Math.abs(x.at - b.until) < SAME_MS);
      const nextSong = next ? this.songs.get(next.songId) : undefined;
      if (nextSong) return (XF_BARS * 240) / nextSong.song.bpm;
      return 60 / (this.songs.get(b.songId)?.song.bpm ?? 144);
    };
    const keep: Playing[] = [];
    for (const p of this.playing) {
      const b = wanted.find((x) => x.songId === p.songId && Math.abs(x.at - p.at) < SAME_MS);
      if (!b) {
        this.cut(p, now);
        continue;
      }
      const fade = fadeOutOf(b);
      if (b.until !== p.until || Math.abs(fade - p.fadeOut) > 0.001) {
        // A skip or a back moved its end, or the next song changed:
        // re-shape the fade-out, keep the song.
        p.until = b.until;
        p.fadeOut = fade;
        const g = p.gain.gain;
        const v = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(v, now);
        this.fadeOut(p, now, v > 0.01 ? v : 1);
      }
      keep.push(p);
    }
    for (const b of wanted) {
      if (keep.some((p) => p.songId === b.songId && Math.abs(b.at - p.at) < SAME_MS)) continue;
      const song = this.songs.get(b.songId);
      if (!song) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = song.buffer;
      src.loop = true;
      src.playbackRate.value = song.rate;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.Q.value = 0.7;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(gain).connect(this.bus);
      const one = this.ctxTime(b.at); // its bar 1
      const p: Playing = { songId: b.songId, at: b.at, until: b.until, fadeOut: fadeOutOf(b), src, hp, gain };
      // Start XF_BARS bars before the one, or as early as now allows.
      const lead = (XF_BARS * 240) / song.song.bpm;
      const start = Math.max(now + 0.05, one - lead);
      const loopSeconds = (song.loop.bars * 240) / song.song.bpm;
      const into = (((start - one) % loopSeconds) + loopSeconds) % loopSeconds;
      src.start(start, into * song.rate);
      const g = gain.gain, f = hp.frequency;
      g.setValueAtTime(0, start);
      let inEnd: number;
      if (one - start > 0.05) {
        // Under the outgoing song: highs first, the low end on the one.
        f.setValueAtTime(HP_HOLD, start);
        f.setValueAtTime(HP_HOLD, one);
        f.exponentialRampToValueAtTime(HP_OPEN, one + SWAP_S);
        powerRamp(g, start, one, 0, 1);
        inEnd = one;
      } else {
        // Under way (a resume, a skip, a song that just loaded): straight in.
        f.setValueAtTime(HP_OPEN, start);
        powerRamp(g, start, start + 0.1, 0, 1);
        inEnd = start + 0.1;
      }
      this.fadeOut(p, inEnd, 1);
      keep.push(p);
    }
    this.playing = keep;
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
    const now = this.ctx.currentTime;
    for (const p of this.playing) this.cut(p, now);
    this.playing = [];
    this.master.disconnect();
  }
}
