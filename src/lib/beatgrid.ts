/**
 * Beat grid of a generated track: its real tempo and where its bars start.
 *
 * Suno is asked for a tempo but does not hold it exactly, and its first
 * downbeat is not at 0:00. The adaptive mixer (mixer.ts) needs both to the
 * millisecond: it stretches every layer to the workout's exact tempo and
 * cuts a loop of whole bars, so three different tracks run on one grid.
 *
 * Method: an onset envelope (rises in compressed energy, plus the low end
 * where kick and bass sit), then a comb search over tempo and phase near
 * the requested tempo, refined by a least-squares fit through the onsets. The bar phase is the beat of four
 * where the low end hits hardest. `jitterMs` says how tightly
 * the strong onsets sit to the grid; above MAX_JITTER_MS the caller must
 * refuse the track, never mix it off the beat.
 *
 * Pure and synchronous: tested in scripts/beatgrid.test.ts.
 */

/** Envelope frames per second, nominal: the real rate is sampleRate / hop. */
const FRAME_RATE = 100;
/** How far from the requested tempo the search looks, as a fraction. */
const TEMPO_SPAN = 0.06;
/**
 * Most a track's strong onsets may scatter around the fitted grid (RMS,
 * ms). Real Suno layers measured ±4.7 and ±9.8 ms on the owner's phone;
 * noise scatters ~22 ms across the ±40 ms search window.
 */
export const MAX_JITTER_MS = 15;
/** How far over the mean onset level a beat's onset must reach to count as a hit. */
const HIT_OVER_BACKGROUND = 4;
/**
 * Least share of a loop's beats that must carry a real hit. A real track
 * drops the kick for fills and phrase ends: Suno layers measured 89-94 %
 * on 8-32 bars. An intro or breakdown section lands near half or below.
 */
export const MIN_COVERAGE = 0.75;
/** Most beats in a row a loop may go without a hit: two bars, a fill. */
export const MAX_GAP_BEATS = 8;

export interface BeatGrid {
  bpm: number;
  /** Seconds to the first downbeat. */
  downbeat: number;
  /** RMS distance of the strong onsets from the grid, ms. */
  jitterMs: number;
  /**
   * Share of beats with a real hit on the grid: an onset within ±25 ms,
   * HIT_OVER_BACKGROUND times the section's mean onset level or more. An
   * intro or a breakdown has beats without one.
   */
  coverage: number;
  /** Most beats in a row without a hit: a fill is a few, a breakdown dozens. */
  longestGap: number;
}

/**
 * Onset strength per frame: rises in compressed energy, full band plus the
 * low band. Compressed, not logarithmic: a log rise is the same for any
 * hit out of silence, so an off-beat bass note starting from a quiet floor
 * outscores the kick it follows, and the grid lands half a beat off.
 */
export function onsetEnvelope(mono: Float32Array, sampleRate: number): { env: Float32Array; low: Float32Array; fps: number } {
  const hop = Math.round(sampleRate / FRAME_RATE);
  const frames = Math.floor(mono.length / hop);
  const out = new Float32Array(frames);
  const lowOut = new Float32Array(frames);
  // One-pole low-pass at ~150 Hz for the kick and bass.
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  let lp = 0;
  let prevFull = 0, prevLow = 0;
  for (let f = 0; f < frames; f++) {
    let full = 0, low = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const x = mono[i] ?? 0;
      lp = (1 - a) * x + a * lp;
      full += x * x;
      low += lp * lp;
    }
    lowOut[f] = low / hop;
    const lf = Math.log1p((10 * full) / hop), ll = Math.log1p((10 * low) / hop);
    out[f] = f === 0 ? 0 : Math.max(0, lf - prevFull) + Math.max(0, ll - prevLow);
    prevFull = lf;
    prevLow = ll;
  }
  // The hop is rounded to whole samples, so the frame rate is not exactly
  // FRAME_RATE: 22050 Hz gives 99.77 fps, a 0.23 % tempo error if ignored.
  return { env: out, low: lowOut, fps: sampleRate / hop };
}

/** Envelope value at a fractional frame. */
function at(env: Float32Array, x: number): number {
  const i = Math.floor(x);
  const t = x - i;
  return (env[i] ?? 0) * (1 - t) + (env[i + 1] ?? 0) * t;
}

/** Mean envelope on the beats of `period` frames from `phase`. */
function combScore(env: Float32Array, period: number, phase: number, step = 1): number {
  let sum = 0, n = 0;
  for (let x = phase; x < env.length - 1; x += period * step) {
    sum += at(env, x);
    n++;
  }
  return n ? sum / n : 0;
}

/** Light smoothing so the comb score is continuous in tempo and phase. */
function smooth(env: Float32Array): Float32Array {
  const k = [1, 2, 3, 2, 1];
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += (k[j + 2] ?? 0) * (env[i + j] ?? 0);
    out[i] = s / 9;
  }
  return out;
}

/**
 * Exact tempo and phase from the onsets themselves: the strongest onset
 * within ±40 ms of every predicted beat, then a least-squares line through
 * them (beat number → frame). Weak beats (below the median) are left out.
 */
function fitBeats(env: Float32Array, period: number, phase: number): { period: number; phase: number; rms: number; coverage: number; longestGap: number } {
  const pts: { k: number; x: number; v: number }[] = [];
  for (let k = 0; phase + k * period < env.length - 5; k++) {
    const c = Math.round(phase + k * period);
    let bi = -1, bv = -1;
    for (let i = Math.max(1, c - 4); i <= c + 4 && i < env.length - 1; i++) {
      const v = env[i] ?? 0;
      if (v > bv) { bv = v; bi = i; }
    }
    if (bi < 1) continue;
    // Parabolic interpolation around the peak frame.
    const l = env[bi - 1] ?? 0, r = env[bi + 1] ?? 0;
    const d = l - 2 * bv + r;
    const off = d < 0 ? (0.5 * (l - r)) / d : 0;
    pts.push({ k, x: bi + off, v: bv });
  }
  if (pts.length < 8) return { period, phase, rms: Infinity, coverage: 0, longestGap: Infinity };
  const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const use = pts.filter((p) => p.v >= median);
  const n = use.length;
  const mk = use.reduce((s, p) => s + p.k, 0) / n;
  const mx = use.reduce((s, p) => s + p.x, 0) / n;
  let num = 0, den = 0;
  for (const p of use) { num += (p.k - mk) * (p.x - mx); den += (p.k - mk) ** 2; }
  if (den === 0) return { period, phase, rms: Infinity, coverage: 0, longestGap: Infinity };
  const b = num / den;
  const a = mx - b * mk;
  const rms = Math.sqrt(use.reduce((s, p) => s + (p.x - (a + b * p.k)) ** 2, 0) / n);
  // Coverage, on every beat: a hit near the line, not just the strong half.
  // A hit stands well clear of the section's average onset level: an
  // unaccented beat counts, a ripple in an ambient intro does not.
  let background = 0;
  for (const v of env) background += v;
  background /= env.length || 1;
  const tol = 0.025 * FRAME_RATE; // ±25 ms in frames (nominal rate: close enough for a tolerance)
  const hit = new Set(
    pts.filter((p) => p.v >= HIT_OVER_BACKGROUND * background && Math.abs(p.x - (a + b * p.k)) <= tol).map((p) => p.k),
  );
  let longestGap = 0, gap = 0;
  const lastK = pts[pts.length - 1]?.k ?? 0;
  for (let k = 0; k <= lastK; k++) {
    gap = hit.has(k) ? 0 : gap + 1;
    longestGap = Math.max(longestGap, gap);
  }
  return { period: b, phase: a, rms, coverage: hit.size / pts.length, longestGap };
}

export function analyzeBeats(mono: Float32Array, sampleRate: number, expectedBpm: number, span = TEMPO_SPAN): BeatGrid {
  const { env: raw, low, fps } = onsetEnvelope(mono, sampleRate);
  const env = smooth(raw);
  const toPeriod = (bpm: number) => (60 * fps) / bpm;

  // Coarse comb: 0.05 BPM steps, whole-frame phases.
  let best = { period: toPeriod(expectedBpm), phase: 0, score: -1 };
  const lo = expectedBpm * (1 - span), hi = expectedBpm * (1 + span);
  for (let bpm = lo; bpm <= hi; bpm += 0.05) {
    const period = toPeriod(bpm);
    for (let phase = 0; phase < period; phase++) {
      const s = combScore(env, period, phase);
      if (s > best.score) best = { period, phase, score: s };
    }
  }
  // Exact: fit a line through the real onsets, twice.
  let { period, phase } = best;
  let rms = Infinity, coverage = 0, longestGap = Infinity;
  for (let i = 0; i < 2; i++) ({ period, phase, rms, coverage, longestGap } = fitBeats(raw, period, phase));
  while (phase >= period) phase -= period;
  while (phase < 0) phase += period;

  // Bar phase: of the four beats, the one with the most low end (kick and
  // bass land together on the one). Loudness, not the onset envelope: a
  // log-energy rise is the same for a soft kick and a hard one.
  let bar = 0, barScore = -1;
  for (let b = 0; b < 4; b++) {
    let sum = 0, n = 0;
    for (let x = phase + b * period; x < low.length - 6; x += 4 * period) {
      let peak = 0;
      for (let i = Math.max(0, Math.round(x) - 2); i <= Math.round(x) + 5; i++) peak = Math.max(peak, low[i] ?? 0);
      sum += peak;
      n++;
    }
    const s = n ? sum / n : 0;
    if (s > barScore) { bar = b; barScore = s; }
  }
  return {
    bpm: (60 * fps) / period,
    downbeat: (phase + bar * period) / fps,
    jitterMs: (rms / fps) * 1000,
    coverage,
    longestGap,
  };
}

/** A loop to cut: whole bars from a downbeat, at the section's own tempo. */
export interface Loop {
  /** Seconds into the track of the loop's first downbeat. */
  start: number;
  bars: number;
  /** The section's own tempo: what the mixer stretches from. */
  bpm: number;
  jitterMs: number;
  coverage: number;
  longestGap: number;
}

/** Loop lengths to try, longest first: whole phrases. */
const LOOP_BARS = [32, 16, 8];

/**
 * The steadiest section of a track, as a loop. A generated track is not a
 * sequencer pattern: it can open on an ambient intro, drop its kick for a
 * breakdown, or drift a little in tempo. So the whole track only gives the
 * tempo roughly; then every section of `bars` bars, in steps of 4 bars,
 * gets its own grid. A section qualifies when nearly every beat carries a
 * hit (MIN_COVERAGE), none goes two bars without one (MAX_GAP_BEATS: a
 * fill passes, a breakdown does not) and they sit tight to the grid (MAX_JITTER_MS); the
 * tightest qualifying section is the loop. Longer loops first; null when no section has a steady beat,
 * with the best section's numbers for the log.
 */
export function findLoop(
  mono: Float32Array,
  sampleRate: number,
  expectedBpm: number,
): { loop: Loop | null; bpm: number; jitterMs: number; coverage: number; longestGap: number } {
  const whole = analyzeBeats(mono, sampleRate, expectedBpm);
  const duration = mono.length / sampleRate;
  const barS = 240 / whole.bpm;
  let closest = { bpm: whole.bpm, jitterMs: whole.jitterMs, coverage: whole.coverage, longestGap: whole.longestGap };
  for (const bars of LOOP_BARS) {
    // One spare bar, so the first downbeat (within a bar) still leaves
    // `bars` whole bars inside the section.
    const len = (bars + 1) * barS;
    let best: Loop | null = null;
    for (let s = 0; s + len <= duration; s += 4 * barS) {
      const slice = mono.subarray(Math.round(s * sampleRate), Math.round((s + len) * sampleRate));
      const g = analyzeBeats(slice, sampleRate, whole.bpm, 0.01);
      if (g.coverage > closest.coverage) closest = { bpm: g.bpm, jitterMs: g.jitterMs, coverage: g.coverage, longestGap: g.longestGap };
      const start = s + g.downbeat;
      if (g.jitterMs > MAX_JITTER_MS || g.coverage < MIN_COVERAGE || g.longestGap > MAX_GAP_BEATS || start + (bars * 240) / g.bpm > duration) continue;
      if (!best || g.jitterMs < best.jitterMs) best = { start, bars, bpm: g.bpm, jitterMs: g.jitterMs, coverage: g.coverage, longestGap: g.longestGap };
    }
    if (best) return { loop: best, bpm: best.bpm, jitterMs: best.jitterMs, coverage: best.coverage, longestGap: best.longestGap };
  }
  return { loop: null, ...closest };
}
