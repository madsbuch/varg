/**
 * The loop to cut from a song, from the beats and downbeats a neural
 * network found in it (beat-this.ts).
 *
 * The mixer stretches a loop of whole bars to the song's exact tempo and
 * starts it on a stretch's first beat, so the loop must begin on a real
 * downbeat and its beats must be steady. A generated track is not a
 * sequencer pattern: it can open on an intro, drop its beat for a
 * breakdown, or drift a little. So every downbeat the network found is a
 * candidate start, and a section of `bars` bars from it qualifies when:
 *
 *  - every beat is there, evenly spaced (no gap, no doubled beat), at a
 *    tempo within MAX_STRETCH of the song's;
 *  - the beats sit on a straight line (MAX_JITTER_MS: the network places
 *    beats on 20 ms frames, which alone is ±6 ms);
 *  - the network's own downbeats inside it keep falling on the one
 *    (MIN_DOWNBEATS_ON_ONE), so the loop's bar 1 is the music's bar 1.
 *
 * Of those, the loudest wins: the main section or the drop, which is what
 * a hard block wants (the owner heard the sparse start of every track
 * again and again before). A longer loop beats a shorter one within
 * LONGER_WITHIN_DB, so the music repeats less. Pure: scripts/beatgrid.test.ts.
 */

/** Loop lengths, in bars: whole phrases. */
const LOOP_BARS = [48, 32, 16, 8];
/** How far (dB) a longer loop may be quieter than the loudest and still win. */
const LONGER_WITHIN_DB = 1.5;
/** RMS distance (ms) of a section's beats from their fitted line. */
export const MAX_JITTER_MS = 25;
/** Share of the network's downbeats in a section that must land on its ones. */
export const MIN_DOWNBEATS_ON_ONE = 0.75;
/** How far a section's tempo may be from the song's before it is refused. */
export const MAX_STRETCH = 0.06;
/** A beat interval this far from the section's median is a gap or an extra beat. */
const IBI_TOLERANCE = 0.25;

export interface Loop {
  /** Seconds into the track of the loop's first downbeat. */
  start: number;
  bars: number;
  /** The section's own tempo: what the mixer stretches from. */
  bpm: number;
  jitterMs: number;
  /** Share of the network's downbeats in the loop that fall on its ones. */
  onOne: number;
  /** Mean level of the loop, dB full scale: the loudest section wins. */
  levelDb: number;
}

/** Mean level of a stretch of the track, dB (full scale). */
export function levelDb(mono: Float32Array, sampleRate: number, from: number, seconds: number): number {
  const a = Math.max(0, Math.round(from * sampleRate)), b = Math.min(mono.length, Math.round((from + seconds) * sampleRate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += (mono[i] ?? 0) ** 2;
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12);
}

/**
 * Start (s) of the loudest `seconds`-long window, in 0.5 s steps: where
 * the beat model looks first, since the loop it is after is the loudest
 * steady section anyway.
 */
export function loudestWindow(mono: Float32Array, sampleRate: number, seconds: number): number {
  const total = mono.length / sampleRate;
  if (total <= seconds) return 0;
  const prefix = new Float64Array(mono.length + 1);
  for (let i = 0; i < mono.length; i++) prefix[i + 1] = (prefix[i] ?? 0) + (mono[i] ?? 0) ** 2;
  const len = Math.round(seconds * sampleRate);
  let best = 0, bestSum = -1;
  for (let s = 0; s + seconds <= total; s += 0.5) {
    const a = Math.round(s * sampleRate);
    const sum = (prefix[Math.min(mono.length, a + len)] ?? 0) - (prefix[a] ?? 0);
    if (sum > bestSum) { bestSum = sum; best = s; }
  }
  return best;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** The best loop, or null with why, in numbers for the log. */
export function loopFromBeats(
  beats: number[],
  downbeats: number[],
  mono: Float32Array,
  sampleRate: number,
  expectedBpm: number,
  maxBars = 48,
): { loop: Loop | null; why: string } {
  const duration = mono.length / sampleRate;
  const found: Loop[] = [];
  const whole = beats.length > 1 ? 60 / median(beats.slice(1).map((b, i) => b - (beats[i] ?? 0))) : 0;
  let steadiest = Infinity;
  for (const d of downbeats) {
    const i0 = beats.indexOf(d);
    if (i0 < 0) continue;
    for (const bars of LOOP_BARS.filter((b) => b <= maxBars)) {
      const n = 4 * bars;
      const section = beats.slice(i0, i0 + n + 1);
      if (section.length < n + 1) continue;
      const ibis = section.slice(1).map((b, i) => b - (section[i] ?? 0));
      const med = median(ibis);
      if (Math.abs(60 / med / expectedBpm - 1) > MAX_STRETCH) continue;
      if (ibis.some((x) => Math.abs(x / med - 1) > IBI_TOLERANCE)) continue;
      // Least-squares line, beat number → time.
      const mk = n / 2;
      const mt = section.reduce((s, t) => s + t, 0) / section.length;
      let num = 0, den = 0;
      section.forEach((t, k) => { num += (k - mk) * (t - mt); den += (k - mk) ** 2; });
      const slope = num / den, start = mt - slope * mk;
      const jitterMs = Math.sqrt(section.reduce((s, t, k) => s + (t - (start + slope * k)) ** 2, 0) / section.length) * 1000;
      steadiest = Math.min(steadiest, jitterMs);
      if (jitterMs > MAX_JITTER_MS) continue;
      // The network's downbeats inside the section: on the ones?
      const end = section[n] ?? 0;
      const inside = downbeats.filter((x) => x >= d - 0.01 && x < end - 0.01);
      const onOne = inside.filter((x) => (beats.indexOf(x) - i0) % 4 === 0).length / Math.max(1, inside.length);
      if (inside.length < bars / 2 || onOne < MIN_DOWNBEATS_ON_ONE) continue;
      const seconds = slope * n;
      if (start < 0 || start + seconds > duration) continue;
      found.push({ start, bars, bpm: 60 / slope, jitterMs, onOne, levelDb: levelDb(mono, sampleRate, start, seconds) });
    }
  }
  if (!found.length) {
    return {
      loop: null,
      why:
        `${String(beats.length)} beats, ${String(downbeats.length)} downbeats, ~${whole.toFixed(1)} BPM` +
        (Number.isFinite(steadiest) ? `, steadiest section ±${steadiest.toFixed(1)} ms` : ", no 8 steady bars in a row"),
    };
  }
  const loudest = Math.max(...found.map((l) => l.levelDb));
  const best = found
    .filter((l) => l.levelDb >= loudest - LONGER_WITHIN_DB)
    .sort((x, y) => y.bars - x.bars || y.levelDb - x.levelDb)[0];
  return { loop: best ?? null, why: "" };
}
