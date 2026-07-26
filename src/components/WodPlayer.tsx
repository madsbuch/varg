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
import type { Exercise } from "../types";
import { useApp } from "../lib/app-context";
import { newSession, uid, upsertSession } from "../lib/store";
import { libraryFor } from "../lib/library";
import type { AnimKey } from "./ExerciseAnim";
import { cueFinish, cueRest, cueTick, cueWork } from "../lib/beep";
import { getCachedTrack } from "../lib/music";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose } from "./icons";
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

/** Index of the step the given elapsed time falls inside. */
function stepIndexAt(steps: Step[], elapsed: number): number {
  for (let i = steps.length - 1; i > 0; i--) {
    if ((steps[i]?.at ?? 0) <= elapsed) return i;
  }
  return 0;
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
  const [logged, setLogged] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const paused = clock.pausedAt !== null;
  const done = elapsed >= total;

  // The lead-in countdown is not workout time. Report the same figure the
  // template card promises: stations and rests, nothing else.
  const workTotal = total - READY_SECS;
  const workElapsed = Math.min(workTotal, Math.max(0, elapsed - READY_SECS));

  // Sample the clock: immediately whenever it changes, then on a cadence
  // while it is running.
  useEffect(() => {
    const read = () => {
      const now = clock.pausedAt ?? Date.now();
      setElapsed(Math.max(0, (now - clock.anchor) / 1000));
    };
    read();
    if (clock.pausedAt !== null) return;
    const id = setInterval(read, 100);
    return () => { clearInterval(id); };
  }, [clock]);

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

  const togglePause = () => {
    const now = Date.now();
    setClock((c) =>
      c.pausedAt === null
        ? { ...c, pausedAt: now }
        : { anchor: c.anchor + (now - c.pausedAt), pausedAt: null },
    );
  };

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
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (paused || done) a.pause();
    else a.play().catch(() => undefined);
  }, [paused, done, trackUrl]);

  // --- Screen wake lock ----------------------------------------------------
  // Android drops the lock whenever the page is hidden, so re-request it
  // every time we come back to the foreground.
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = () => {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((s) => {
          if (alive) sentinel = s;
          else void s.release().catch(() => undefined);
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  const logSession = () => {
    update((d) => {
      const s = newSession(config.title ?? `WOD ${String(config.work)}/${String(config.rest)}`);
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
          () => ({ id: uid("set"), seconds: config.work, done: true }),
        ),
      }));
      return upsertSession(d, s);
    });
    setLogged(true);
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
          {logged ? (
            <div className="chip accent" style={{ margin: "0 auto" }}>
              <IconCheck style={{ width: 14, height: 14 }} /> Logged to history
            </div>
          ) : (
            <button className="btn primary" onClick={logSession}>
              Log as session
            </button>
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
        <button
          className="check"
          onClick={() => { setConfirmStop(true); }}
          aria-label="Stop"
        >
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

      {trackUrl && <audio ref={audioRef} src={trackUrl} loop autoPlay />}

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
              <button
                className="btn ghost"
                onClick={() => { setConfirmStop(false); }}
              >
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
