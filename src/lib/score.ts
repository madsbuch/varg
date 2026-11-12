/**
 * The ride's music as a score: every song voice it plays, in wall-clock
 * time, with its gain and high-pass as points to interpolate.
 *
 * One schedule, two players. The browser mixer (mixer.ts) turns a score
 * into Web Audio nodes; the native ride service (RideService, MusicEngine.kt)
 * renders the very same score into an AudioTrack, off screen as on it. A
 * voice's place in its song is a pure function of the clock (`start`,
 * `offset`, `rate`), so a recomputed score that keeps a voice keeps it
 * byte for byte, and either player can swap scores without a seam.
 *
 * The rules are the mixer's (CLAUDE.md, adaptive rides): a stretch's song
 * lands bar 1 on the block's first beat; it comes in over the 3-2-1
 * before it, under the song going out, low end held back by a high-pass
 * until the one; only the ride's first block starts earlier, with the
 * lead-in, cutting its low end for the 3-2-1 and dropping on Go. Pure and
 * tested: scripts/score.test.ts.
 */

/** A song as the score needs it (from mixer.ts SongLoop). */
export interface ScoreSong {
  id: string;
  bpm: number;
  /** Playback rate that brings the loop to the song's tempo. */
  rate: number;
  /** Loudness trim to its intensity's level. */
  trim: number;
  /** Buffer seconds of lead-up before bar 1 (the loop's start). */
  pre: number;
  /** Buffer seconds in all: lead-up then the loop. */
  duration: number;
}

/** A song booked for a stretch of the ride, in wall-clock ms. */
export interface Booking {
  songId: string;
  at: number;
  /** Null: ends on kcal, unknowable ahead; rebooked when it ends. */
  until: number | null;
}

export type Points = [number, number][];

export interface Voice {
  songId: string;
  /** The booking's bar 1 (wall ms): with songId, what makes it the same voice. */
  at: number;
  until: number | null;
  /** Wall ms it starts sounding, and the buffer second it starts at. */
  start: number;
  offset: number;
  /** Wall ms it stops; null while its end is unknown. */
  stop: number | null;
  rate: number;
  trim: number;
  /** The loop within the buffer, seconds: it wraps from loopEnd to loopStart. */
  loopStart: number;
  loopEnd: number;
  /** [wall ms, gain 0-1] and [wall ms, high-pass Hz], linear between points. */
  gain: Points;
  hp: Points;
  /** Cut short (no longer booked, or paused): fading out, then gone. */
  cut?: boolean | undefined;
}

/** Seconds of crossfade: the 3-2-1 countdown into every block, no longer. */
export const XF_S = 3;
/** The incoming song's high-pass while it waits for the one, and open. */
export const HP_HOLD = 300;
export const HP_OPEN = 10;
const SWAP_S = 0.03;
/** The ride's first song fades in over this from the lead-in's start. */
const INTRO_FADE_S = 0.5;
/** How fast the low end is cut before the drop on the ride's first one. */
const CUT_IN_S = 0.15;
/** Fade for anything cut short: a skip, a pause, a stop. */
export const CUT_S = 0.06;
/** Bookings this close (ms) are the same booking, rebooked. */
const SAME_MS = 50;

/** Value of a point curve at `t`: held before the first and after the last. */
export function valueAt(points: Points, t: number): number {
  const first = points[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!a || !b) break;
    if (t <= b[0]) return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
  }
  return points[points.length - 1]?.[1] ?? 0;
}

/** An equal-power move from `from` to `to` over [t0, t1] ms, as points. */
function powerRamp(t0: number, t1: number, from: number, to: number): Points {
  const n = 8, up = to > from, out: Points = [[t0, from]];
  for (let i = 1; i <= n; i++) {
    const x = i / n;
    const shape = up ? Math.sin((x * Math.PI) / 2) : 1 - Math.cos((x * Math.PI) / 2);
    out.push([t0 + (t1 - t0) * x, from + (to - from) * shape]);
  }
  return out;
}

/** The fade-out of a voice ending at `until`, from `from` (wall ms) at `level`. */
function fadeOutPoints(until: number, fadeS: number, from: number, level: number): Points {
  const start = Math.max(from, until - fadeS * 1000);
  return [[start, level], ...powerRamp(start, Math.max(start + 10, until), level, 0).slice(1)];
}

/** Buffer second a voice is at, at wall time `t`: the loop wraps. */
export function positionAt(v: Pick<Voice, "start" | "offset" | "rate" | "loopStart" | "loopEnd">, t: number): number {
  const p = v.offset + ((t - v.start) / 1000) * v.rate;
  if (p < v.loopEnd) return p;
  const len = v.loopEnd - v.loopStart;
  return v.loopStart + ((p - v.loopStart) % len);
}

/** A voice cut short at `now`: its gain to silence in CUT_S, then stopped. */
function cut(v: Voice, now: number): Voice {
  const g = valueAt(v.gain, now);
  return {
    ...v,
    gain: [...v.gain.filter((p) => p[0] < now), [now, g], [now + CUT_S * 1000, 0]],
    stop: Math.min(v.stop ?? Infinity, now + CUT_S * 1000 + 10),
    cut: true,
  };
}

/**
 * The score from `now` on, given the previous one: voices still booked keep
 * their start and offset (only a moved end re-shapes their fade-out),
 * voices no longer booked are cut, new bookings get a voice. `firstAt` is
 * the plan's first block: the only one allowed to start before its 3-2-1.
 */
export function scoreVoices(
  prev: Voice[],
  bookings: Booking[],
  songs: Map<string, ScoreSong>,
  now: number,
  paused: boolean,
  firstAt?: number,
): Voice[] {
  // Voices already cut and done fall away.
  const alive = prev.filter((v) => v.stop === null || v.stop > now);
  if (paused) return alive.map((v) => (v.cut ? v : cut(v, now)));
  const wanted = bookings.filter((b) => songs.has(b.songId) && (b.until === null || b.until > now + 20));
  // How long each booking fades out: the next song's crossfade when one
  // follows straight on, else one beat of its own.
  const fadeOf = (b: Booking): number => {
    const next = wanted.find((x) => b.until !== null && Math.abs(x.at - b.until) < SAME_MS);
    if (next) return XF_S;
    return 60 / (songs.get(b.songId)?.bpm ?? 144);
  };
  const out: Voice[] = [];
  for (const v of alive) {
    if (v.cut) {
      out.push(v);
      continue;
    }
    const b = wanted.find((x) => x.songId === v.songId && Math.abs(x.at - v.at) < SAME_MS);
    if (!b) {
      out.push(cut(v, now));
      continue;
    }
    if (b.until === v.until) {
      out.push(v);
      continue;
    }
    // A skip or a back moved its end: keep the song, re-shape the fade-out.
    const level = valueAt(v.gain, now);
    const kept = v.gain.filter((p) => p[0] < now);
    const gain: Points = b.until === null
      ? [...kept, [now, level], [now + 100, Math.max(level, 1)]]
      : [...kept, [now, level], ...fadeOutPoints(b.until, fadeOf(b), now, level > 0.01 ? level : 1)];
    out.push({ ...v, until: b.until, stop: b.until === null ? null : b.until + 20, gain });
  }
  for (const b of wanted) {
    if (out.some((v) => !v.cut && v.songId === b.songId && Math.abs(v.at - b.at) < SAME_MS)) continue;
    const s = songs.get(b.songId);
    if (!s) continue;
    const one = b.at;
    const leadIn = firstAt !== undefined && Math.abs(b.at - firstAt) < SAME_MS;
    const start = Math.max(now + 50, leadIn ? -Infinity : one - XF_S * 1000);
    // Where in the buffer to start, so bar 1 (the buffer at `pre`) plays
    // at `one`: in the real lead-up when it reaches back far enough, else
    // wrapped round the loop (a long lead-in), or into the loop when the
    // stretch is already under way.
    const loopLen = s.duration - s.pre;
    const ahead = ((one - start) / 1000) * s.rate;
    const offset = ahead <= s.pre ? s.pre - ahead : s.pre + (((-ahead % loopLen) + loopLen) % loopLen);
    let gain: Points, hp: Points, inEnd: number;
    if (!leadIn && one - start > 50) {
      // Over the 3-2-1, under the outgoing song (or out of silence):
      // highs first, the low end on the one.
      gain = powerRamp(start, one, 0, 1);
      hp = [[start, HP_HOLD], [one, HP_HOLD], [one + SWAP_S * 1000, HP_OPEN]];
      inEnd = one;
    } else if (leadIn && one - start > (XF_S + INTRO_FADE_S) * 1000) {
      // The lead-in: full song from the countdown's start, then the kick
      // and bass cut for the 3-2-1 and dropped on the one.
      gain = powerRamp(start, start + INTRO_FADE_S * 1000, 0, 1);
      const cutAt = one - XF_S * 1000;
      hp = [[start, HP_OPEN], [cutAt, HP_OPEN], [cutAt + CUT_IN_S * 1000, HP_HOLD], [one, HP_HOLD], [one + SWAP_S * 1000, HP_OPEN]];
      inEnd = start + INTRO_FADE_S * 1000;
    } else {
      // Under way (a resume, a skip, a song that just loaded, or too little
      // lead-in left to build): straight in.
      gain = powerRamp(start, start + 100, 0, 1);
      hp = [[start, HP_OPEN]];
      inEnd = start + 100;
    }
    if (b.until !== null) gain = [...gain, ...fadeOutPoints(b.until, fadeOf(b), inEnd, 1)];
    out.push({
      songId: b.songId, at: b.at, until: b.until, start, offset,
      stop: b.until === null ? null : b.until + 20,
      rate: s.rate, trim: s.trim, loopStart: s.pre, loopEnd: s.duration, gain, hp,
    });
  }
  return out;
}
