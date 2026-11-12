/**
 * The log-mel spectrogram Beat This! was trained on, in TypeScript.
 *
 * Mirrors beat_this.preprocessing.LogMelSpect (torchaudio MelSpectrogram):
 * 22050 Hz mono, 1024-point FFT, hop 441 (50 frames/s), periodic Hann
 * window, centred frames with reflect padding, magnitude divided by √1024
 * (torchaudio's "frame_length" mode), 128 Slaney mel bands from 30 Hz to
 * 11 kHz without area normalisation, then log1p(1000 · x).
 *
 * The network only knows this exact input: any drift here is a model
 * reading the wrong picture. scripts/melspec.test.ts compares it against
 * the Python reference value by value.
 */

export const SAMPLE_RATE = 22050;
export const N_FFT = 1024;
export const HOP = 441;
export const N_MELS = 128;
export const FPS = SAMPLE_RATE / HOP; // 50
const F_MIN = 30;
const F_MAX = 11000;
const LOG_MULTIPLIER = 1000;

// Slaney mel scale: linear below 1 kHz, logarithmic above.
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOGSTEP = Math.log(6.4) / 27;

function hzToMel(f: number): number {
  return f >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP : f / F_SP;
}
function melToHz(m: number): number {
  return m >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL)) : m * F_SP;
}

/** torchaudio.functional.melscale_fbanks(513, 30, 11000, 128, 22050, norm=None, "slaney"): [freq][mel]. */
export function melFilterbank(): Float64Array[] {
  const nFreqs = N_FFT / 2 + 1;
  const all = Array.from({ length: nFreqs }, (_, i) => (i * (SAMPLE_RATE / 2)) / (nFreqs - 1));
  const mMin = hzToMel(F_MIN), mMax = hzToMel(F_MAX);
  const fPts = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (N_MELS + 1)));
  const fb: Float64Array[] = [];
  for (let f = 0; f < nFreqs; f++) {
    const row = new Float64Array(N_MELS);
    const hz = all[f] ?? 0;
    for (let m = 0; m < N_MELS; m++) {
      const lo = fPts[m] ?? 0, mid = fPts[m + 1] ?? 0, hi = fPts[m + 2] ?? 0;
      const down = (hz - lo) / (mid - lo);
      const up = (hi - hz) / (hi - mid);
      row[m] = Math.max(0, Math.min(down, up));
    }
    fb.push(row);
  }
  return fb;
}

/** In-place iterative radix-2 FFT of length N_FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

let cachedFb: { f: number; m: number; w: number }[][] | null = null;

/** The filterbank as sparse columns: for each mel band, its nonzero bins. */
function sparseFb(): { f: number; m: number; w: number }[][] {
  if (cachedFb) return cachedFb;
  const fb = melFilterbank();
  const cols: { f: number; m: number; w: number }[][] = Array.from({ length: N_MELS }, () => []);
  fb.forEach((row, f) => {
    row.forEach((w, m) => { if (w > 0) cols[m]?.push({ f, m, w }); });
  });
  cachedFb = cols;
  return cols;
}

/**
 * Log-mel spectrogram of 22050 Hz mono audio: frames × 128, row-major.
 * floor(n / 441) + 1 frames, as torchaudio's centred STFT gives.
 */
export function logMelSpect(mono: Float32Array): { data: Float32Array; frames: number } {
  const half = N_FFT / 2;
  const frames = Math.floor(mono.length / HOP) + 1;
  // Reflect padding by half a window at each end (torch "reflect": the
  // edge sample is not repeated).
  const at = (i: number): number => {
    const n = mono.length;
    if (n === 1) return mono[0] ?? 0;
    let j = i;
    while (j < 0 || j >= n) j = j < 0 ? -j : 2 * (n - 1) - j;
    return mono[j] ?? 0;
  };
  const win = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  // torchaudio's "frame_length" normalisation: divide by √n_fft (not by
  // the window's energy, which is its "window" mode).
  const norm = 1 / Math.sqrt(N_FFT);
  const cols = sparseFb();
  const out = new Float32Array(frames * N_MELS);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  const mag = new Float64Array(half + 1);
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - half;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = at(start + i) * (win[i] ?? 0);
      im[i] = 0;
    }
    fft(re, im);
    for (let f = 0; f <= half; f++) mag[f] = Math.hypot(re[f] ?? 0, im[f] ?? 0) * norm;
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      for (const c of cols[m] ?? []) s += c.w * (mag[c.f] ?? 0);
      out[t * N_MELS + m] = Math.log1p(LOG_MULTIPLIER * s);
    }
  }
  return { data: out, frames };
}
