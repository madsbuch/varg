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
import { useApp } from "../lib/app-context";
import { deleteSession, upsertSession } from "../lib/store";
import { advanceProgress, buildSteps, newWodProgress, recordedSession, READY_SECS } from "../lib/wod";
import type { Step, StepKind, WodConfig } from "../lib/wod";
import { libraryFor } from "../lib/library";
import { useBackHandler } from "../lib/back";
import type { AnimKey } from "./ExerciseAnim";
import { cueFinish, cueRest, cueTick, cueWork, unlockAudio } from "../lib/beep";
import { loadVoiceOn, poseLine, saveVoiceOn, speak } from "../lib/voice";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose, IconVoice } from "./icons";
import { useBattleTrack, useWorkoutWakeLock } from "./battle-track";
import { formatSeconds } from "../lib/units";

/** The workout's position on the wall clock. */
interface Clock {
  anchor: number; // ms timestamp where elapsed == 0
  pausedAt: number | null; // ms timestamp the clock is frozen at
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
  const name = step.exercise?.name ?? "Work";
  return step.side ? `${name} · ${step.side}` : name;
}

function stepAnim(step: Step): AnimKey {
  if (step.kind === "work" && step.exercise) return libraryFor(step.exercise).anim;
  return "rest";
}

/** A one-sided pose on the side its animation does not draw: flip it. */
function stepMirror(step: Step): boolean {
  if (step.kind !== "work" || !step.exercise || !step.side) return false;
  const drawn = libraryFor(step.exercise).side;
  return drawn !== undefined && drawn !== step.side;
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
  const [startedAt] = useState(() => new Date().toISOString());
  const progress = useRef(newWodProgress());
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [hasWork, setHasWork] = useState(false);
  // Finishing always logs, so the only thing the completion screen needs
  // to re-render on is whether the athlete removed the session again. The
  // id itself only has to survive re-renders, not drive them.
  const loggedId = useRef<string | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const paused = clock.pausedAt !== null;
  const done = stoppedEarly || elapsed >= total;

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
      advanceProgress(progress.current, steps, e);
      setRecordedDuration(progress.current.duration);
      setHasWork(progress.current.work.some((seconds) => seconds > 0));
      setElapsed(e);
      return e;
    };
    const first = read();
    if (clock.pausedAt !== null || first >= total) return;
    const id = setInterval(() => {
      if (read() >= total) clearInterval(id);
    }, 100);
    return () => { clearInterval(id); };
  }, [clock, total, steps]);

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
  // A flow speaks each pose as it begins instead of beeping — including the
  // first one, during the lead-in, so the athlete can get into it.
  const flow = config.sequence !== undefined;
  const [voiceOn, setVoiceOn] = useState(loadVoiceOn);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const cuedStep = useRef(flow ? -1 : 0);
  useEffect(() => {
    if (cuedStep.current === stepIdx) return;
    cuedStep.current = stepIdx;
    const s = steps[stepIdx];
    if (!s) {
      cueFinish();
      return;
    }
    if (flow && voiceOn && s.exercise) {
      const line = poseLine(s.exercise.name, s.side, s.kind === "ready" ? "First: " : "");
      speak(line).then(
        () => { setVoiceError(null); },
        (e: unknown) => {
          // Say why there is no voice, and still give the transition a sound.
          setVoiceError(e instanceof Error ? e.message : String(e));
          if (s.kind === "work") cueRest();
        },
      );
      return;
    }
    if (flow) {
      if (s.kind === "work") cueRest();
      return;
    }
    if (s.kind === "work") cueWork();
    else cueRest();
  }, [stepIdx, steps, flow, voiceOn]);

  const cuedTick = useRef("");
  useEffect(() => {
    // Holds in a flow end on the next pose's name, not a 3-2-1 beep — except
    // the lead-in, which still counts down.
    if (flow && steps[stepIdx]?.kind !== "ready") return;
    if (paused || done || remain > 3 || remain < 1) return;
    const key = `${String(stepIdx)}:${String(remain)}`;
    if (cuedTick.current === key) return;
    cuedTick.current = key;
    cueTick();
  }, [remain, stepIdx, paused, done, flow, steps]);

  // --- Transport -----------------------------------------------------------
  // Date.now() is read here in the handler, never inside the updater, so
  // the state transition itself stays pure.
  const seek = useCallback((seconds: number) => {
    const now = Date.now();
    const current = (clock.pausedAt ?? now) - clock.anchor;
    advanceProgress(progress.current, steps, current / 1000);
    progress.current.position = Math.max(0, seconds);
    setRecordedDuration(progress.current.duration);
    setClock({ ...clock, anchor: (clock.pausedAt ?? now) - Math.max(0, seconds) * 1000 });
  }, [clock, steps]);

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

  // --- Battle track & wake lock -------------------------------------------
  const track = useBattleTrack(config.trackKey, paused, done);
  useWorkoutWakeLock(done);

  const logSession = useCallback(() => {
    const session = recordedSession(config, steps, progress.current, startedAt, stoppedEarly);
    if (session.entries.length === 0) return null;
    update((d) => upsertSession(d, session));
    return session.id;
  }, [config, steps, startedAt, stoppedEarly, update]);

  const stopAndSave = () => {
    // Freeze at the dialog's pause time, including the fraction since the last tick.
    const at = ((clock.pausedAt ?? Date.now()) - clock.anchor) / 1000;
    advanceProgress(progress.current, steps, at);
    setRecordedDuration(progress.current.duration);
    setConfirmStop(false);
    setHasWork(progress.current.work.some((seconds) => seconds > 0));
    setStoppedEarly(true);
  };

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
          <span className="eyebrow">{stoppedEarly ? "Workout stopped" : "Mission complete"}</span>
          <button className="check" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="wod-center">
          <div className="wod-phase" style={{ color: "var(--gold)" }}>
            {stoppedEarly ? "Stopped early" : "Complete"}
          </div>
          <div className="wod-time">{formatSeconds(recordedDuration)}</div>
          <div className="muted" style={{ textAlign: "center" }}>
            Recorded time · only performed intervals are saved
          </div>
        </div>
        <div className="wod-controls">
          {!hasWork ? (
            <div className="muted">No work intervals recorded.</div>
          ) : discarded ? (
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
          {config.title ? `${config.title} · ` : ""}
          {config.sequence
            ? `Pose ${String(step.round)}/${String(config.sequence.length)}`
            : `Round ${String(step.round)}/${String(config.rounds)}`}
        </span>
        <span className="chip">
          {formatSeconds(workElapsed)} / {formatSeconds(workTotal)}
        </span>
        {flow && (
          <button
            className={`check music ${voiceOn ? "on" : ""}`}
            aria-label={voiceOn ? "Stop speaking pose names" : "Speak pose names"}
            onClick={() => {
              const next = !voiceOn;
              setVoiceOn(next);
              saveVoiceOn(next);
              if (!next) setVoiceError(null);
            }}
          >
            <IconVoice />
          </button>
        )}
        {track.musicButton}
        <button className="check" onClick={openConfirmStop} aria-label="Stop">
          <IconClose />
        </button>
      </div>

      <div className="wod-progress" aria-hidden>
        <div style={{ width: `${String((workElapsed / workTotal) * 100)}%` }} />
      </div>

      <div className="wod-center">
        <div className="wod-phase">{flow && step.kind === "work" ? "Hold" : PHASE_LABEL[step.kind]}</div>
        <div className={`wod-time ${remain <= 3 ? "urgent" : ""}`}>
          {formatSeconds(remain)}
        </div>

        <div className="wod-anim">
          <ExerciseAnim anim={stepAnim(step)} size={170} mirror={stepMirror(step)} />
        </div>
        <div className="wod-exname">{stepTitle(step)}</div>
        {flow && step.exercise && (
          <ul className="wod-cues">
            {libraryFor(step.exercise).cues.slice(0, 2).map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {flow && voiceOn && voiceError && (
          <div className="wod-voice-error">Voice unavailable: {voiceError}</div>
        )}

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
                <ExerciseAnim anim={stepAnim(s)} size={38} mirror={stepMirror(s)} />
              </div>
              <span className="wod-queue-name">{stepTitle(s)}</span>
              <span className="wod-queue-secs">{formatSeconds(s.secs)}</span>
            </div>
          ))
        )}
      </div>

      {track.audioElement}

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
              {formatSeconds(recordedDuration)} recorded. Save only the intervals
              you performed, including time in the current station.
            </p>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={stopAndSave}>
              Stop &amp; save
            </button>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={keepGoing}>
                Keep going
              </button>
              <button className="btn danger" onClick={onClose}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
