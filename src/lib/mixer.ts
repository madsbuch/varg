/**
 * The adaptive mixer: songs from the collection (src/lib/songs.ts), each
 * playing the stretch of the ride it is booked for, as one continuous set.
 *
 * Each song is decoded, its real tempo and downbeat found (beatgrid.ts),
 * and its loudest steady section cut as a loop of whole bars, played at
 * the rate that makes its bars exactly the song's tempo. A stretch of the
 * ride starts its song at bar 1 of that loop, on the stretch's first
 * beat; the song before fades out over its last beat. Every timed block is
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
import { findLoop } from "./beatgrid";
import type { Loop } from "./beatgrid";
import type { Song } from "./songs";

/** A song ready to mix: its loop and how to play it. */
export interface SongLoop {
  song: Song;
  buffer: AudioBuffer;
  /** Playback rate that brings the loop's section to the song's tempo. */
  rate: number;
  loop: Loop;
}

/** Analysis runs on a mono copy at about this rate: plenty for a beat. */
const ANALYSIS_RATE = 22050;
/** How far Suno's tempo may sit from the request before it is refused. */
const MAX_STRETCH = 0.06;
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
 * Decode a song and cut its loop. `known` is a loop found on an earlier
 * ride for this very track: then only the cut is done, not the analysis.
 * Throws a LayerError ("Jazz house: no steady beat") when the song cannot
 * be mixed in time.
 */
export async function prepareSong(ctx: BaseAudioContext, blob: Blob, song: Song, known?: Loop): Promise<SongLoop> {
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new LayerError(`${song.name}: can't decode`, "decodeAudioData refused it");
  }
  let loop = known;
  if (!loop) {
    const { mono, rate } = analysisMono(decoded);
    const found = findLoop(mono, rate, song.bpm, SONG_LOOP_BARS);
    if (!found.loop) {
      throw new LayerError(
        `${song.name}: no steady beat`,
        `${found.bpm.toFixed(2)} BPM; best section ${(found.coverage * 100).toFixed(0)} % of beats hit, ` +
        `longest gap ${String(found.longestGap)} beats, ±${found.jitterMs.toFixed(1)} ms`,
      );
    }
    loop = found.loop;
  }
  if (Math.abs(loop.bpm / song.bpm - 1) > MAX_STRETCH) {
    throw new LayerError(`${song.name}: tempo off`, `${loop.bpm.toFixed(2)} BPM against ${String(song.bpm)}`);
  }

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
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** How far the music drops under a cue. */
const DUCK_LEVEL = 0.22;
const DUCK_RAMP_S = 0.06;
/** A stretch's song comes in on its first beat with this short fade. */
const ATTACK_S = 0.02;
/** Fade for anything cut short: a skip, a pause, a stop. */
const CUT_S = 0.06;
/** Bookings this close (ms) are the same booking, rebooked. */
const SAME_MS = 50;

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
    p.src.onended = () => { p.src.disconnect(); p.gain.disconnect(); };
    p.src.stop(now + CUT_S + 0.01);
  }

  /** The gain envelope of a booking: in from `inAt` over `inFor`, out over its last beat. */
  private envelope(p: Playing, song: SongLoop, inAt: number, inFor: number): void {
    const now = this.ctx.currentTime;
    const g = p.gain.gain;
    const v = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(v, now);
    const start = Math.max(now, inAt);
    if (start > now) g.setValueAtTime(v, start);
    g.linearRampToValueAtTime(1, start + inFor);
    if (p.until === null) return;
    const end = this.ctxTime(p.until);
    const beat = 60 / song.song.bpm;
    const fadeFrom = Math.max(start + inFor, end - beat);
    g.setValueAtTime(1, fadeFrom);
    g.linearRampToValueAtTime(0, Math.max(fadeFrom + 0.01, end));
    p.src.onended = () => { p.src.disconnect(); p.gain.disconnect(); };
    p.src.stop(Math.max(fadeFrom + 0.02, end + 0.02));
  }

  /**
   * Play these bookings from now on. Bookings already playing or scheduled
   * stay (their end is updated); bookings no longer wanted are cut; new
   * ones are scheduled. A booking already under way starts where the ride
   * clock says it would be, so a resume picks up mid-song in time.
   */
  book(bookings: Booking[], paused: boolean): void {
    const now = this.ctx.currentTime;
    if (paused) {
      for (const p of this.playing) this.cut(p, now);
      this.playing = [];
      return;
    }
    const wallNow = Date.now();
    const keep: Playing[] = [];
    const wanted = bookings.filter((b) => this.songs.has(b.songId) && (b.until === null || b.until > wallNow + 20));
    for (const p of this.playing) {
      const b = wanted.find((x) => x.songId === p.songId && Math.abs(x.at - p.at) < SAME_MS);
      if (!b) {
        this.cut(p, now);
        continue;
      }
      if (b.until !== p.until) {
        // A skip or a back moved its end: re-shape the fade, keep the song.
        p.until = b.until;
        const song = this.songs.get(p.songId);
        if (song) this.envelope(p, song, now, 0.01);
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
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.bus);
      const at = this.ctxTime(b.at);
      const p: Playing = { songId: b.songId, at: b.at, until: b.until, src, gain };
      if (at >= now + 0.02) {
        // Ahead: bar 1 of the loop on the stretch's first beat.
        src.start(at, 0);
        this.envelope(p, song, at, ATTACK_S);
      } else {
        // Under way (a resume, a song that just loaded): join where the
        // ride clock says the song is.
        const t0 = now + 0.05;
        const loopSeconds = (song.loop.bars * 240) / song.song.bpm;
        const into = (((t0 - at) % loopSeconds) + loopSeconds) % loopSeconds;
        src.start(t0, into * song.rate);
        this.envelope(p, song, t0, 0.1);
      }
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
