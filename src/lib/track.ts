/**
 * Battle-track playback channel.
 *
 * A generated track is almost always SHORTER than the workout it scores —
 * Suno caps a track at six minutes, Varg 18 runs 17:50. So the
 * track repeats, and the two problems that creates are solved here:
 *
 *  - The seam. A bare `loop` attribute restarts the element instantly and
 *    mid-phrase, once per loop. This channel fades the tail out and the head back in instead.
 *  - The cues. Music and countdown used to run at full volume down two
 *    independent paths, so a 100 ms tick competed with a 160 BPM track.
 *    Playback is routed through the same AudioContext as the cues, and
 *    ducks under each one.
 *
 * Routing also fixes autoplay. `unlockAudio()` resumes the context inside
 * the Start tap, and audio flowing through a running context is not
 * subject to the media element autoplay policy — which matters because a
 * track can finish composing minutes into a workout, long after the tap's
 * user activation has expired.
 *
 * An <audio> element can only ever have ONE MediaElementSource, and once
 * it has one, all of its audio flows through that graph — disconnect the
 * graph and the element goes silent while still reporting that it plays.
 * So the node chain is cached per element and reused on every re-attach
 * (StrictMode double-invokes effects; a track arriving mid-workout
 * remounts the element), and tearing a channel down resets its gains
 * rather than disconnecting anything.
 *
 * With no context available the caller still gets working playback, just
 * unprocessed — degraded, never silent.
 *
 * Adaptive rides also drive the track's intensity (`setIntensity`). Suno
 * gives one finished mix, not stems, so intensity is shaped after the mix:
 * a low-pass filter muffles a held-back block, and a rising high-pass that
 * thins the bass builds into a hard block, then drops back so the bass
 * slams in on the change. Every change is booked on the context clock.
 */
import type { Intensity } from "../types";
import { getAudioContext } from "./beep";

/** Crossfade length at the loop seam. */
const SEAM_FADE_S = 1.2;
/** How far the music drops under a cue. */
const DUCK_LEVEL = 0.22;
const DUCK_RAMP_S = 0.06;

export interface TrackChannel {
  /** Pull the music down under a cue for `hold` seconds, then restore. */
  duck(hold: number): void;
  /** Overall music level, 0..1. Independent of ducking and seam fades. */
  setVolume(volume: number): void;
  /**
   * Called as the track approaches its end; starts the tail fade once.
   * `remaining` is seconds of audio left.
   */
  fadeOutBeforeEnd(remaining: number): void;
  /** Called after the track has been restarted; fades the head back in. */
  fadeIn(): void;
  /**
   * Play at `level` now, then change at each `in` seconds from now. Replaces
   * whatever was booked before. Level 0 is the track as recorded.
   */
  setIntensity(level: Intensity | 0, changes: { in: number; level: Intensity | 0 }[]): void;
  dispose(): void;
}

/** What each intensity does to the mix: low-pass cutoff and level. */
const INTENSITY: Record<Intensity | 0, { lowpass: number; gain: number }> = {
  0: { lowpass: 20000, gain: 1 },
  1: { lowpass: 650, gain: 0.8 },
  2: { lowpass: 3200, gain: 0.92 },
  3: { lowpass: 20000, gain: 1 },
};
/** The high-pass at rest: below anything audible. */
const HP_REST = 20;
/** Where the high-pass sweep peaks just before a drop into level 3. */
const HP_BUILD = 450;
/** Seconds the build-up into a harder block takes. */
const BUILD_S = 4;
/** Seconds to settle into a softer block. */
const EASE_S = 1.5;

/**
 * Three gain stages, so the seam fade, the cue duck and the user's volume
 * move independently instead of fighting over one AudioParam.
 */
interface Chain {
  seam: GainNode;
  duck: GainNode;
  volume: GainNode;
  lowpass: BiquadFilterNode;
  highpass: BiquadFilterNode;
  drive: GainNode;
}

// Keyed by element: a second createMediaElementSource() on the same element
// throws, and building a second chain would orphan the first.
const chains = new WeakMap<HTMLAudioElement, Chain>();

function ensureChain(ctx: AudioContext, el: HTMLAudioElement): Chain | null {
  const existing = chains.get(el);
  if (existing) return existing;
  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(el);
  } catch {
    // Routed by someone else, and we have no handle on their nodes.
    return null;
  }
  const chain: Chain = {
    seam: ctx.createGain(),
    duck: ctx.createGain(),
    volume: ctx.createGain(),
    lowpass: ctx.createBiquadFilter(),
    highpass: ctx.createBiquadFilter(),
    drive: ctx.createGain(),
  };
  chain.lowpass.type = "lowpass";
  chain.lowpass.frequency.value = INTENSITY[0].lowpass;
  chain.highpass.type = "highpass";
  chain.highpass.frequency.value = HP_REST;
  source
    .connect(chain.seam)
    .connect(chain.duck)
    .connect(chain.volume)
    .connect(chain.lowpass)
    .connect(chain.highpass)
    .connect(chain.drive)
    .connect(ctx.destination);
  chains.set(el, chain);
  return chain;
}

/**
 * Route an <audio> element through the cue context. Returns null when no
 * context exists (never unlocked) — the caller should then let the element
 * play directly rather than leaving it connected to nothing.
 */
export function createTrackChannel(el: HTMLAudioElement): TrackChannel | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  const chain = ensureChain(ctx, el);
  if (!chain) return null;
  const { seam, duck: duckGain, volume, lowpass, highpass, drive } = chain;

  let fading = false;

  const rampTo = (param: AudioParam, value: number, seconds: number) => {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
  };

  return {
    duck(hold) {
      const now = ctx.currentTime;
      const g = duckGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_RAMP_S);
      g.setValueAtTime(DUCK_LEVEL, now + Math.max(DUCK_RAMP_S, hold));
      g.linearRampToValueAtTime(1, now + Math.max(DUCK_RAMP_S, hold) + 0.25);
    },
    setVolume(v) {
      rampTo(volume.gain, Math.min(1, Math.max(0, v)), 0.05);
    },
    fadeOutBeforeEnd(remaining) {
      if (fading) return;
      fading = true;
      rampTo(seam.gain, 0.0001, Math.min(SEAM_FADE_S, Math.max(0.05, remaining)));
    },
    fadeIn() {
      fading = false;
      rampTo(seam.gain, 1, SEAM_FADE_S);
    },
    setIntensity(level, changes) {
      const now = ctx.currentTime;
      const lp = lowpass.frequency, hp = highpass.frequency, g = drive.gain;
      for (const p of [lp, hp, g]) {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
      }
      // Settle into the current level (a rebook at a change is a no-op).
      lp.exponentialRampToValueAtTime(INTENSITY[level].lowpass, now + 0.3);
      g.linearRampToValueAtTime(INTENSITY[level].gain, now + 0.3);
      hp.exponentialRampToValueAtTime(HP_REST, now + 0.3);
      let prev = level;
      let free = now + 0.3; // automation must stay in time order
      for (const c of changes) {
        if (c.level === prev) continue;
        // Never dropped: a change due inside the last one's ramp waits for it.
        const at = Math.max(now + c.in, free + 0.05);
        const from = INTENSITY[prev], to = INTENSITY[c.level];
        if (c.level > prev) {
          // Build: open the filter towards the change; into the hardest
          // block, also thin the bass so it drops back in on the beat.
          const start = Math.max(free, at - BUILD_S);
          lp.setValueAtTime(from.lowpass, start);
          lp.exponentialRampToValueAtTime(to.lowpass, at);
          g.setValueAtTime(from.gain, start);
          g.linearRampToValueAtTime(to.gain, at);
          if (c.level === 3) {
            hp.setValueAtTime(HP_REST, start);
            hp.exponentialRampToValueAtTime(HP_BUILD, at - 0.02);
            hp.setValueAtTime(HP_REST, at);
          }
          free = at;
        } else {
          lp.setValueAtTime(from.lowpass, at);
          lp.exponentialRampToValueAtTime(to.lowpass, at + EASE_S);
          g.setValueAtTime(from.gain, at);
          g.linearRampToValueAtTime(to.gain, at + EASE_S);
          free = at + EASE_S;
        }
        prev = c.level;
      }
    },
    dispose() {
      // Deliberately does NOT disconnect: the element's audio only reaches
      // the speakers through this chain, and the element may outlive this
      // channel. Reset to neutral so a re-attach starts clean.
      fading = false;
      const now = ctx.currentTime;
      for (const g of [seam.gain, duckGain.gain, volume.gain, drive.gain]) {
        g.cancelScheduledValues(now);
        g.setValueAtTime(1, now);
      }
      for (const [f, rest] of [[lowpass.frequency, INTENSITY[0].lowpass], [highpass.frequency, HP_REST]] as const) {
        f.cancelScheduledValues(now);
        f.setValueAtTime(rest, now);
      }
    },
  };
}

/** Seconds before the end at which the tail fade should start. */
export const SEAM_FADE_SECONDS = SEAM_FADE_S;
