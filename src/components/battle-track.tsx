/**
 * Battle-track playback and screen wake lock, shared by the guided players
 * (interval and for-time). Both run full-screen workouts with the same
 * music rules: the cached track plays under the cues through the cue
 * AudioContext, ducks under them, crossfades its loop seam, and says so
 * when the platform stops it instead of going quietly silent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { setCueDucker, unlockAudio } from "../lib/beep";
import type { TrackChannel } from "../lib/track";
import { createTrackChannel, SEAM_FADE_SECONDS } from "../lib/track";
import { getCachedTrack } from "../lib/music";
import { IconMusic } from "./icons";

export interface BattleTrack {
  /** The music button for the player's top bar; null until a track is cached. */
  musicButton: React.ReactNode;
  /** The hidden audio element; render it anywhere in the player. */
  audioElement: React.ReactNode;
}

export function useBattleTrack(
  trackKey: string | undefined,
  paused: boolean,
  done: boolean,
  /** How far cues pull the music down; guided workouts pass mixer.ts LIGHT_DUCK. */
  duckLevel?: number,
): BattleTrack {
  // Play the workout's cached track under the cues. While the track is
  // still composing, keep checking so it joins mid-workout.
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!trackKey) return;
    let url: string | null = null;
    let alive = true;
    const check = () => {
      void getCachedTrack(trackKey)
        .then((t) => {
          if (t && alive && !url) {
            url = URL.createObjectURL(t.blob);
            setTrackUrl(url);
          }
        })
        .catch(() => undefined);
    };
    check();
    const id = setInterval(() => {
      if (!url) check();
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
      if (url) URL.revokeObjectURL(url);
    };
  }, [trackKey]);

  // Route the track through the cue context: ducking, a crossfaded loop
  // seam, and playback that is not subject to the media autoplay policy.
  const channelRef = useRef<TrackChannel | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !trackUrl) return;
    const channel = createTrackChannel(a);
    channelRef.current = channel;
    if (channel) setCueDucker((hold) => { channel.duck(hold, duckLevel); });
    return () => {
      setCueDucker(null);
      channel?.dispose();
      channelRef.current = null;
    };
  }, [trackUrl, duckLevel]);

  // "The track should be playing and isn't": either play() was refused —
  // a track that finishes composing mid-workout mounts long after the tap
  // that started the workout — or the platform stopped the element under
  // us. Say so instead of swallowing it; silent music with no explanation
  // reads as "the feature is broken".
  const [musicBlocked, setMusicBlocked] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const startPlayback = useCallback((a: HTMLAudioElement) => {
    a.play().then(
      () => { setMusicBlocked(false); },
      () => { setMusicBlocked(true); },
    );
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (paused || done || !musicOn) {
      a.pause();
      return;
    }
    // Pausing inside the seam fade leaves a ramp scheduled on the context
    // timeline, which keeps running in context-time while the element is
    // stopped — resume without this and the track is back but inaudible.
    // onTimeUpdate re-arms the fade if we really are near the end.
    channelRef.current?.fadeIn();
    startPlayback(a);
  }, [paused, done, musicOn, trackUrl, startPlayback]);

  const toggle = useCallback(() => {
    // A tap is a fresh user gesture, so this is also the retry path when
    // the WebView refused to autoplay or the platform stopped the element
    // under us.
    if (musicBlocked) {
      const a = audioRef.current;
      unlockAudio();
      setMusicOn(true);
      if (a) startPlayback(a);
      return;
    }
    setMusicOn((m) => !m);
  }, [musicBlocked, startPlayback]);

  // The track is shorter than the workout, so it repeats. Fade the tail
  // out and the head in rather than cutting mid-phrase on every loop.
  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const remaining = a.duration - a.currentTime;
    if (remaining <= SEAM_FADE_SECONDS) channelRef.current?.fadeOutBeforeEnd(remaining);
  }, []);
  // A headphone unplug or a lost audio focus stops the element with no
  // error and no other event, and the button went on claiming "Mute the
  // battle track" over silence. Reflect it instead of replaying: auto-play
  // here would defeat becoming-noisy and make muting — which is itself a
  // pause() — a no-op. Anything we paused on purpose is excluded.
  const onPause = useCallback(() => {
    if (musicOn && !paused && !done) setMusicBlocked(true);
  }, [musicOn, paused, done]);
  const onEnded = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.play().then(
      () => { channelRef.current?.fadeIn(); },
      () => { setMusicBlocked(true); },
    );
  }, []);
  const onPlay = useCallback(() => { setMusicBlocked(false); }, []);

  if (!trackUrl) return { musicButton: null, audioElement: null };
  return {
    musicButton: (
      <button
        className={`check music ${musicBlocked ? "blocked" : musicOn ? "on" : ""}`}
        aria-label={
          musicBlocked
            ? "Tap to restart the battle track"
            : musicOn
              ? "Mute the battle track"
              : "Unmute the battle track"
        }
        onClick={toggle}
      >
        <IconMusic />
      </button>
    ),
    // No `loop` attribute: the seam is crossfaded in onEnded.
    audioElement: (
      <audio
        ref={audioRef}
        src={trackUrl}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
      />
    ),
  };
}

/**
 * Keep the screen on while a workout runs. Android drops the lock whenever
 * the page is hidden, so re-request it every time we come back to the
 * foreground. `done` is in the deps so finishing runs the cleanup: without
 * that the display stays on for as long as the completion screen is up,
 * which is until you find the phone.
 */
export function useWorkoutWakeLock(done: boolean): void {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let alive = true;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Coming back from an incoming call can leave the shared context
      // suspended — every cue and the battle track go silent for the rest
      // of the workout with no other way back.
      unlockAudio();
      if (done || !("wakeLock" in navigator)) return;
      navigator.wakeLock
        .request("screen")
        .then((s) => {
          if (alive) sentinel = s;
          else void s.release().catch(() => undefined);
        })
        .catch(() => undefined);
    };
    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [done]);
}
