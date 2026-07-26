/**
 * Battle-track playback channel.
 *
 * A generated track is almost always SHORTER than the workout it scores —
 * Suno returns a few minutes, Varg 18 runs 17:50 — and nothing in the
 * generation API lets us ask for a specific length. So the track repeats,
 * and the two problems that creates are solved here:
 *
 *  - The seam. A bare `loop` attribute restarts the element instantly and
 *    mid-phrase. Over eighteen minutes that is roughly seven hard cuts.
 *    This channel fades the tail out and the head back in instead.
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
 */
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
  dispose(): void;
}

/**
 * Three gain stages, so the seam fade, the cue duck and the user's volume
 * move independently instead of fighting over one AudioParam.
 */
interface Chain {
  seam: GainNode;
  duck: GainNode;
  volume: GainNode;
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
  };
  source
    .connect(chain.seam)
    .connect(chain.duck)
    .connect(chain.volume)
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
  const { seam, duck: duckGain, volume } = chain;

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
    dispose() {
      // Deliberately does NOT disconnect: the element's audio only reaches
      // the speakers through this chain, and the element may outlive this
      // channel. Reset to neutral so a re-attach starts clean.
      fading = false;
      const now = ctx.currentTime;
      for (const g of [seam.gain, duckGain.gain, volume.gain]) {
        g.cancelScheduledValues(now);
        g.setValueAtTime(1, now);
      }
    },
  };
}

/** Seconds before the end at which the tail fade should start. */
export const SEAM_FADE_SECONDS = SEAM_FADE_S;
