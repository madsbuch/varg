/**
 * Fullscreen interval-WOD player.
 *
 * Two design rules drive this component:
 *
 *  1. What is on screen is what you are doing RIGHT NOW. Rest is its own
 *     block with its own (deliberately still) figure — never the next
 *     exercise's animation, which reads as "start moving".
 *  2. The next two steps are always visible, because with short rests the
 *     genuinely useful lookahead is "rest, then burpees", not "burpees".
 *
 * Timing is anchored to the wall clock rather than accumulated from a
 * setInterval, so the workout survives a re-render, a dropped frame, or
 * the WebView being frozen in standby: whatever happened, elapsed time is
 * derived from Date.now() and the current step falls out of it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Exercise, WorkoutSet } from "../types";
import { useApp } from "../lib/app-context";
import { deleteSession, newSession, uid, upsertSession } from "../lib/store";
import { libraryFor } from "../lib/library";
import { useBackHandler } from "../lib/back";
import type { AnimKey } from "./ExerciseAnim";
import {
  cueFinish,
  cueRest,
  cueTick,
  cueWork,
  setCueDucker,
  unlockAudio,
} from "../lib/beep";
import type { TrackChannel } from "../lib/track";
import { createTrackChannel, SEAM_FADE_SECONDS } from "../lib/track";
import { getCachedTrack } from "../lib/music";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose, IconMusic } from "./icons";
import { formatSeconds } from "../lib/units";

export interface WodConfig {
  exercises: Exercise[];
  work: number; // seconds
  rest: number; // seconds
  rounds: number;
  title?: string; // template name; falls back to "WOD work/rest"
  trackKey?: string; // battle-track cache key — plays during the WOD if cached
}

type StepKind = "ready" | "work" | "rest";

interface Step {
  kind: StepKind;
  /** The station this step is about. For rest/ready: the one coming up. */
  exercise: Exercise | undefined;
  round: number; // 1-based; for rest, the round the NEXT station belongs to
  secs: number;
  at: number; // seconds from workout start
}

const READY_SECS = 5;

/** The workout's position on the wall clock. */
interface Clock {
  anchor: number; // ms timestamp where elapsed == 0
  pausedAt: number | null; // ms timestamp the clock is frozen at
}

/**
 * Expand a config into the flat list of steps, each stamped with its
 * absolute offset so the current step is a lookup, not a countdown.
 */
function buildSteps(cfg: WodConfig): Step[] {
  const steps: Step[] = [];
  let at = 0;
  const push = (s: Omit<Step, "at">) => {
    steps.push({ ...s, at });
    at += s.secs;
  };

  push({ kind: "ready", exercise: cfg.exercises[0], round: 1, secs: READY_SECS });

  for (let r = 1; r <= cfg.rounds; r++) {
    cfg.exercises.forEach((ex, i) => {
      push({ kind: "work", exercise: ex, round: r, secs: cfg.work });
      const isVeryLast = r === cfg.rounds && i === cfg.exercises.length - 1;
      if (isVeryLast || cfg.rest <= 0) return;
      // Rest belongs to whatever comes after it — that is what the athlete
      // needs to see, and what the round counter should already be showing.
      const wraps = i === cfg.exercises.length - 1;
      push({
        kind: "rest",
        exercise: cfg.exercises[wraps ? 0 : i + 1],
        round: wraps ? r + 1 : r,
        secs: cfg.rest,
      });
    });
  }
  return steps;
}

/**
 * Index of the step the given elapsed time falls inside. Binary search,
 * not a scan: `steps` is sorted by `at` by construction, and this runs on
 * every render at 10 Hz — a long circuit builds a lot of steps and a
 * linear walk of them is the frame budget.
 */
function stepIndexAt(steps: Step[], elapsed: number): number {
  let lo = 0;
  let hi = steps.length - 1;
  // Invariant: steps[0].at is 0 and elapsed is never negative, so lo is
  // always a valid answer and the loop only ever moves it forward.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((steps[mid]?.at ?? 0) <= elapsed) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

function stepTitle(step: Step): string {
  if (step.kind === "rest") return "Rest";
  if (step.kind === "ready") return "Get ready";
  return step.exercise?.name ?? "Work";
}

function stepAnim(step: Step): AnimKey {
  if (step.kind === "work" && step.exercise) return libraryFor(step.exercise).anim;
  return "rest";
}

/**
 * One logged set for one pass through a station.
 *
 * The player knows the prescription, not the performance: it can say the
 * station ran for `work` seconds, it cannot say what happened inside it.
 * So only time-shaped metrics carry a number, and nothing is checked off
 * — `prs.ts` gates PR detection on `done`, and a 60 s plank station must
 * not mint a "Plank — Best hold 1:00" the athlete never held.
 */
function prescribedSet(ex: Exercise, work: number): WorkoutSet {
  const set: WorkoutSet = { id: uid("set"), done: false };
  if (ex.metric === "time" || ex.metric === "distance_time") set.seconds = work;
  return set;
}

const PHASE_LABEL: Record<StepKind, string> = {
  ready: "Get ready",
  work: "Work",
  rest: "Rest",
};

export default function WodPlayer({
  config,
  onClose,
}: {
  config: WodConfig;
  onClose: () => void;
}) {
  const { update } = useApp();
  const steps = useMemo(() => buildSteps(config), [config]);
  const total = useMemo(
    () => steps.reduce((a, s) => a + s.secs, 0),
    [steps],
  );

  // --- Wall-clock timeline -------------------------------------------------
  // `anchor` is the wall-clock moment where elapsed == 0. Pausing freezes
  // the read, skipping slides the anchor. Everything else is derived from
  // it, so nothing can drift out of sync — not a re-render, not standby.
  const [clock, setClock] = useState<Clock>(() => ({
    anchor: Date.now(),
    pausedAt: null,
  }));
  const [elapsed, setElapsed] = useState(0);
  // Finishing always logs, so the only thing the completion screen needs
  // to re-render on is whether the athlete removed the session again. The
  // id itself only has to survive re-renders, not drive them.
  const loggedId = useRef<string | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const paused = clock.pausedAt !== null;
  const done = elapsed >= total;

  // The lead-in countdown is not workout time. Report the same figure the
  // template card promises: stations and rests, nothing else.
  const workTotal = total - READY_SECS;
  const workElapsed = Math.min(workTotal, Math.max(0, elapsed - READY_SECS));

  // Sample the clock: immediately whenever it changes, then on a cadence
  // while it is running. Reaching the end does not pause the clock, so the
  // sampler has to stop itself — and the stop condition has to be checked
  // against the value the tick just computed, because `elapsed` in this
  // closure is whatever it was when the effect last ran.
  useEffect(() => {
    const read = () => {
      const now = clock.pausedAt ?? Date.now();
      const e = Math.max(0, (now - clock.anchor) / 1000);
      setElapsed(e);
      return e;
    };
    const first = read();
    if (clock.pausedAt !== null || first >= total) return;
    const id = setInterval(() => {
      if (read() >= total) clearInterval(id);
    }, 100);
    return () => { clearInterval(id); };
  }, [clock, total]);

  // Which step the clock is inside. Derived every render — that is the
  // whole point: no state to fall behind, no catch-up loop to run.
  const stepIdx = done ? steps.length : stepIndexAt(steps, elapsed);
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const remain = step ? Math.max(0, Math.ceil(step.at + step.secs - elapsed)) : 0;

  // The next two steps — rest included, because with 10 s rests the useful
  // lookahead is "rest, then push-ups".
  const upNext = useMemo(
    () => steps.slice(stepIdx + 1, stepIdx + 3),
    [steps, stepIdx],
  );

  // --- Audio cues ----------------------------------------------------------
  // Cue on entering a step. Deriving the step from the clock means a long
  // standby gap lands on one step and fires one cue, never a burst.
  const cuedStep = useRef(0);
  useEffect(() => {
    if (cuedStep.current === stepIdx) return;
    cuedStep.current = stepIdx;
    const s = steps[stepIdx];
    if (!s) cueFinish();
    else if (s.kind === "work") cueWork();
    else cueRest();
  }, [stepIdx, steps]);

  const cuedTick = useRef("");
  useEffect(() => {
    if (paused || done || remain > 3 || remain < 1) return;
    const key = `${String(stepIdx)}:${String(remain)}`;
    if (cuedTick.current === key) return;
    cuedTick.current = key;
    cueTick();
  }, [remain, stepIdx, paused, done]);

  // --- Transport -----------------------------------------------------------
  // Date.now() is read here in the handler, never inside the updater, so
  // the state transition itself stays pure.
  const seek = useCallback((seconds: number) => {
    const now = Date.now();
    setClock((c) => ({
      ...c,
      anchor: (c.pausedAt ?? now) - Math.max(0, seconds) * 1000,
    }));
  }, []);

  const togglePause = useCallback(() => {
    // Resuming is a user gesture, and it is the moment a context suspended
    // by audio-focus loss (an incoming call mid-workout) can be revived.
    unlockAudio();
    const now = Date.now();
    setClock((c) =>
      c.pausedAt === null
        ? { ...c, pausedAt: now }
        : { anchor: c.anchor + (now - c.pausedAt), pausedAt: null },
    );
  }, []);

  // The stop dialog covers the Pause button, so without this the timeline
  // runs on behind the modal: you lose exactly as much workout as you
  // spend deciding, and a long enough deliberation ends it outright.
  // Decided inside the updater, not from `clock` in this closure: if a Pause
  // tap and this one ever land in the same JS task, a stale closure reads the
  // workout as running, "pauses" an already-paused clock — which resumes it —
  // and the timeline runs on behind the modal.
  const wasAutoPaused = useRef(false);
  const openConfirmStop = useCallback(() => {
    setConfirmStop(true);
    const now = Date.now();
    setClock((c) => {
      if (c.pausedAt !== null) return c;
      wasAutoPaused.current = true;
      return { ...c, pausedAt: now };
    });
  }, []);

  const keepGoing = useCallback(() => {
    setConfirmStop(false);
    if (!wasAutoPaused.current) return;
    wasAutoPaused.current = false;
    togglePause();
  }, [togglePause]);

  // Back must never dismiss the player — an edge-swipe at minute 18 used
  // to close the app outright, skipping every confirmation. Route it to
  // the same guard the on-screen X uses. On the completion screen the
  // session is already logged, so there it is an ordinary close.
  const onBack = useCallback(() => {
    if (done) onClose();
    else if (confirmStop) keepGoing();
    else openConfirmStop();
    return true;
  }, [done, confirmStop, keepGoing, openConfirmStop, onClose]);
  useBackHandler(true, onBack);

  const skip = () => {
    const next = steps[stepIdx + 1];
    seek(next ? next.at : total);
  };

  /** Media-player behaviour: restart this step, or jump back if just started. */
  const back = () => {
    if (!step) {
      seek(steps[steps.length - 1]?.at ?? 0);
      return;
    }
    const into = elapsed - step.at;
    if (into > 2) seek(step.at);
    else seek(steps[stepIdx - 1]?.at ?? 0);
  };

  // --- Battle track --------------------------------------------------------
  // Play the workout's cached track under the cues. While the track is
  // still composing, keep checking so it joins mid-workout.
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const trackKey = config.trackKey;
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
  }, [config.trackKey]);
  // Route the track through the cue context: ducking, a crossfaded loop
  // seam, and playback that is not subject to the media autoplay policy.
  const channelRef = useRef<TrackChannel | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !trackUrl) return;
    const channel = createTrackChannel(a);
    channelRef.current = channel;
    if (channel) setCueDucker((hold) => { channel.duck(hold); });
    return () => {
      setCueDucker(null);
      channel?.dispose();
      channelRef.current = null;
    };
  }, [trackUrl]);

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

  // The track is shorter than the workout, so it repeats. Fade the tail
  // out and the head in rather than cutting mid-phrase seven times over.
  const onTrackTime = () => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const remaining = a.duration - a.currentTime;
    if (remaining <= SEAM_FADE_SECONDS) channelRef.current?.fadeOutBeforeEnd(remaining);
  };
  // A headphone unplug or a lost audio focus stops the element with no
  // error and no other event, and the button went on claiming "Mute the
  // battle track" over silence. Reflect it instead of replaying: auto-play
  // here would defeat becoming-noisy and make muting — which is itself a
  // pause() — a no-op. Anything we paused on purpose is excluded.
  const onTrackPause = () => {
    if (musicOn && !paused && !done) setMusicBlocked(true);
  };
  const onTrackEnded = () => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.play().then(
      () => { channelRef.current?.fadeIn(); },
      () => { setMusicBlocked(true); },
    );
  };

  // --- Screen wake lock ----------------------------------------------------
  // Android drops the lock whenever the page is hidden, so re-request it
  // every time we come back to the foreground. `done` is in the deps so
  // finishing runs the cleanup: without that the display stays on for as
  // long as the completion screen is up, which is until you find the phone.
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

  const logSession = useCallback(() => {
    const s = newSession(
      config.title ?? `WOD ${String(config.work)}/${String(config.rest)}`,
    );
    s.note = `${String(config.rounds)} rounds · ${String(config.work)}s on / ${String(config.rest)}s off`;
    s.finishedAt = new Date().toISOString();
    // A station can appear more than once per round (cardio between every
    // exercise); that is more sets of one exercise, not a second entry.
    const perRound = new Map<string, Exercise>();
    const stations = new Map<string, number>();
    for (const ex of config.exercises) {
      perRound.set(ex.id, ex);
      stations.set(ex.id, (stations.get(ex.id) ?? 0) + 1);
    }
    s.entries = [...perRound.values()].map((ex) => ({
      id: uid("entry"),
      exerciseId: ex.id,
      sets: Array.from(
        { length: config.rounds * (stations.get(ex.id) ?? 1) },
        () => prescribedSet(ex, config.work),
      ),
    }));
    update((d) => upsertSession(d, s));
    return s.id;
  }, [config, update]);

  // Finishing the workout saves it. The X in the corner is the same icon
  // in the same slot that opens the guarded stop sheet mid-workout, and it
  // used to throw the whole session away in one unconfirmed tap; the way
  // out of that is to make the tap harmless, not to add a fourth dialog.
  useEffect(() => {
    if (!done || loggedId.current !== null || discarded) return;
    loggedId.current = logSession();
  }, [done, discarded, logSession]);

  const removeLog = () => {
    const id = loggedId.current;
    if (id === null) return;
    update((d) => deleteSession(d, id));
    loggedId.current = null;
    setDiscarded(true);
  };

  const relog = () => {
    loggedId.current = logSession();
    setDiscarded(false);
  };

  if (done) {
    return (
      <div className="wod">
        <div className="wod-top">
          <span className="eyebrow">Mission complete</span>
          <button className="check" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="wod-center">
          <div className="wod-phase" style={{ color: "var(--gold)" }}>
            Complete
          </div>
          <div className="wod-time">{formatSeconds(workTotal)}</div>
          <div className="muted" style={{ textAlign: "center" }}>
            {config.rounds} rounds · {config.exercises.length} stations ·{" "}
            {config.work}s on / {config.rest}s off
          </div>
        </div>
        <div className="wod-controls">
          {discarded ? (
            <button className="btn primary" onClick={relog}>
              Log as session
            </button>
          ) : (
            <>
              <div className="chip accent" style={{ margin: "0 auto" }}>
                <IconCheck style={{ width: 14, height: 14 }} /> Logged to history
              </div>
              <button
                className="btn ghost"
                style={{ marginTop: 10 }}
                onClick={removeLog}
              >
                Remove from history
              </button>
            </>
          )}
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!step) return null;

  const resting = step.kind !== "work";
  const stepFrac = step.secs > 0 ? 1 - remain / step.secs : 1;

  return (
    <div className={`wod ${resting ? "resting" : ""}`}>
      <div className="wod-top">
        <span className="chip">
          {config.title ? `${config.title} · ` : ""}Round {step.round}/
          {config.rounds}
        </span>
        <span className="chip">
          {formatSeconds(workElapsed)} / {formatSeconds(workTotal)}
        </span>
        {trackUrl && (
          <button
            className={`check music ${musicBlocked ? "blocked" : musicOn ? "on" : ""}`}
            aria-label={
              musicBlocked
                ? "Tap to restart the battle track"
                : musicOn
                  ? "Mute the battle track"
                  : "Unmute the battle track"
            }
            onClick={() => {
              // A tap is a fresh user gesture, so this is also the retry
              // path when the WebView refused to autoplay or the platform
              // stopped the element under us.
              if (musicBlocked) {
                const a = audioRef.current;
                unlockAudio();
                setMusicOn(true);
                if (a) startPlayback(a);
                return;
              }
              setMusicOn((m) => !m);
            }}
          >
            <IconMusic />
          </button>
        )}
        <button className="check" onClick={openConfirmStop} aria-label="Stop">
          <IconClose />
        </button>
      </div>

      <div className="wod-progress" aria-hidden>
        <div style={{ width: `${String((workElapsed / workTotal) * 100)}%` }} />
      </div>

      <div className="wod-center">
        <div className="wod-phase">{PHASE_LABEL[step.kind]}</div>
        <div className={`wod-time ${remain <= 3 ? "urgent" : ""}`}>
          {formatSeconds(remain)}
        </div>

        <div className="wod-anim">
          <ExerciseAnim anim={stepAnim(step)} size={170} />
        </div>
        <div className="wod-exname">{stepTitle(step)}</div>

        <div className="wod-stepbar" aria-hidden>
          <div style={{ width: `${String(stepFrac * 100)}%` }} />
        </div>
      </div>

      <div className="wod-queue">
        <div className="wod-queue-label">Up next</div>
        {upNext.length === 0 ? (
          <div className="wod-queue-row last">
            <span className="wod-queue-name">Last station — empty the tank</span>
          </div>
        ) : (
          upNext.map((s, i) => (
            <div
              key={`${String(stepIdx)}-${String(i)}`}
              className={`wod-queue-row ${s.kind === "work" ? "" : "is-rest"} ${i > 0 ? "dim" : ""}`}
            >
              <div className="wod-queue-anim">
                <ExerciseAnim anim={stepAnim(s)} size={38} />
              </div>
              <span className="wod-queue-name">{stepTitle(s)}</span>
              <span className="wod-queue-secs">{formatSeconds(s.secs)}</span>
            </div>
          ))
        )}
      </div>

      {/* No `loop` attribute: the seam is crossfaded in onTrackEnded. */}
      {trackUrl && (
        <audio
          ref={audioRef}
          src={trackUrl}
          onTimeUpdate={onTrackTime}
          onEnded={onTrackEnded}
          onPlay={() => { setMusicBlocked(false); }}
          onPause={onTrackPause}
        />
      )}

      <div className="wod-controls">
        <div className="btn-row">
          <button className="btn ghost" onClick={back} aria-label="Back">
            ◀
          </button>
          <button className="btn grow" onClick={togglePause}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn ghost" onClick={skip} aria-label="Skip">
            ▶
          </button>
        </div>
      </div>

      {confirmStop && (
        <div className="wod-confirm">
          <div className="card">
            <h3 style={{ fontSize: 17 }}>Stop the workout?</h3>
            <p className="muted" style={{ fontSize: 14 }}>
              {formatSeconds(workElapsed)} of {formatSeconds(workTotal)} done. Nothing
              is logged if you stop now.
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={keepGoing}>
                Keep going
              </button>
              <button className="btn danger" onClick={onClose}>
                Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
