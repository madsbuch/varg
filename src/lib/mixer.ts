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
/**
 * Seconds the incoming song plays under the outgoing one before its bar 1:
 * the 3-2-1 countdown into every block (ride.ts COUNTDOWN), and no longer.
 */
const XF_S = 3;
/**
 * The incoming song's high-pass during the crossfade: its kick and bass
 * wait (so two kicks never clash, even across a tempo change) and drop in
 * on the one, as a DJ swaps the bass.
 */
const HP_HOLD = 300;
const HP_OPEN = 10;
const SWAP_S = 0.03;
/** The ride's first song fades in over this from the lead-in's start. */
const INTRO_FADE_S = 0.5;
/** How fast the low end is cut before the drop on the ride's first one. */
const CUT_IN_S = 0.15;

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
   * starts XF_S early (the 3-2-1), timed so its bar 1 lands on the change,
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
      if (nextSong) return XF_S;
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
      // Loop the loop, not the lead-up kept before it.
      const loopBuf = song.buffer.duration - song.pre;
      src.loopStart = song.pre;
      src.loopEnd = song.buffer.duration;
      src.playbackRate.value = song.rate;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.Q.value = 0.7;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const trim = this.ctx.createGain();
      trim.gain.value = song.trim;
      src.connect(hp).connect(trim).connect(gain).connect(this.bus);
      const one = this.ctxTime(b.at); // its bar 1
      const p: Playing = { songId: b.songId, at: b.at, until: b.until, fadeOut: fadeOutOf(b), src, hp, gain };
      // After another song: start XF_S before the one, under it. With none
      // before (the ride's first, during the lead-in): start now, so the
      // countdown has music too.
      const follows = wanted.some((x) => x !== b && x.until !== null && Math.abs(x.until - b.at) < SAME_MS);
      const start = Math.max(now + 0.05, follows ? one - XF_S : -Infinity);
      // Where in the buffer to start, so bar 1 (the buffer at `pre`) plays
      // at `one`: in the real lead-up when it reaches back far enough,
      // else wrapped round the loop (a long lead-in), or into the loop
      // when the stretch is already under way.
      const ahead = (one - start) * song.rate; // buffer seconds before bar 1
      const offset = ahead <= song.pre
        ? song.pre - ahead
        : song.pre + (((-ahead % loopBuf) + loopBuf) % loopBuf);
      src.start(start, offset);
      const g = gain.gain, f = hp.frequency;
      g.setValueAtTime(0, start);
      let inEnd: number;
      if (follows && one - start > 0.05) {
        // Under the outgoing song: highs first, the low end on the one.
        f.setValueAtTime(HP_HOLD, start);
        f.setValueAtTime(HP_HOLD, one);
        f.exponentialRampToValueAtTime(HP_OPEN, one + SWAP_S);
        powerRamp(g, start, one, 0, 1);
        inEnd = one;
      } else if (!follows && one - start > XF_S + INTRO_FADE_S) {
        // The lead-in: full song from the countdown's start, then the kick
        // and bass cut for the 3-2-1 and dropped on the one.
        f.setValueAtTime(HP_OPEN, start);
        f.setValueAtTime(HP_OPEN, one - XF_S);
        f.exponentialRampToValueAtTime(HP_HOLD, one - XF_S + CUT_IN_S);
        f.setValueAtTime(HP_HOLD, one);
        f.exponentialRampToValueAtTime(HP_OPEN, one + SWAP_S);
        powerRamp(g, start, start + INTRO_FADE_S, 0, 1);
        inEnd = start + INTRO_FADE_S;
      } else {
        // Under way (a resume, a skip, a song that just loaded, or too
        // little lead-in left to build): straight in.
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
