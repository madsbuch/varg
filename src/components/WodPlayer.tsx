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
 * An EMOM runs on the same timeline: every station is a step exactly one
 * minute long, so the minute boundaries are fixed by the clock. Inside the
 * minute the athlete works until Done (reps) or until the timed target has
 * run, and the rest of the minute shows as rest — a phase of the step,
 * derived like everything else, never a timer of its own.
 *
 * Timing is anchored to the wall clock rather than accumulated from a
 * setInterval, so the workout survives a re-render, a dropped frame, or
 * the WebView being frozen in standby: whatever happened, elapsed time is
 * derived from Date.now() and the current step falls out of it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { deleteSession, upsertSession } from "../lib/store";
import {
  advanceProgress, buildSteps, clockElapsed, emomPhase, newWodProgress, recordedSession,
  seekClock, stepIndexAt, togglePauseClock,
} from "../lib/wod";
import type { Clock, Step, StepKind, WodConfig } from "../lib/wod";
import { libraryFor } from "../lib/library";
import { useBackHandler } from "../lib/back";
import type { AnimKey } from "./ExerciseAnim";
import { cueFinish, cueRest, cueTick, cueWork, unlockAudio } from "../lib/beep";
import { loadVoiceOn, saveVoiceOn, speak } from "../lib/voice";
import { cueLine, playClip, prepareClips, restLine, stepLines, voiceConfigured } from "../lib/voice-clips";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose, IconVoice } from "./icons";
import { useBattleTrack, useWorkoutWakeLock } from "./battle-track";
import { useHeartRate } from "./HeartRate";
import { Slot, TopTitle } from "./TopBar";
import { formatSeconds } from "../lib/units";

/**
 * In a circuit, rest is rest: a still figure, never the next exercise
 * (which reads as "start moving"). In a flow the move between poses IS
 * getting into the next pose, so it shows that pose — and its side.
 */
const showsPose = (step: Step, flow: boolean) =>
  step.kind === "work" || (flow && step.kind === "rest");

function stepTitle(step: Step, flow = false): string {
  if (!showsPose(step, flow)) return step.kind === "rest" ? "Rest" : "Get ready";
  const name = step.exercise?.name ?? "Work";
  return step.side ? `${name} · ${step.side}` : name;
}

function stepAnim(step: Step, flow = false): AnimKey {
  if (showsPose(step, flow) && step.exercise) return libraryFor(step.exercise).anim;
  return "rest";
}

/** A one-sided pose on the side its animation does not draw: flip it. */
function stepMirror(step: Step, flow = false): boolean {
  if (!showsPose(step, flow) || !step.exercise || !step.side) return false;
  const drawn = libraryFor(step.exercise).side;
  return drawn !== undefined && drawn !== step.side;
}

const PHASE_LABEL: Record<StepKind, string> = {
  ready: "Get ready",
  work: "Work",
  rest: "Rest",
};

/** What an upcoming step asks for: an EMOM's target, otherwise its length. */
function stepAmount(step: Step): string {
  return step.emom ? step.emom.target : formatSeconds(step.secs);
}

export default function WodPlayer({
  config,
  onClose,
  withHr = false,
}: {
  config: WodConfig;
  onClose: () => void;
  /** The pre-workout step connected the strap (HrConnectSheet). */
  withHr?: boolean;
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
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
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
  // EMOM: seconds into each station step at which Done was tapped.
  const [doneMarks, setDoneMarks] = useState<Readonly<Record<number, number>>>({});

  const paused = clock.pausedAt !== null;
  const done = stoppedEarly || elapsed >= total;

  // The lead-in countdown is not workout time. Report the same figure the
  // template card promises: stations and rests, nothing else.
  const leadIn = steps[0]?.secs ?? 0;
  const workTotal = total - leadIn;
  const workElapsed = Math.min(workTotal, Math.max(0, elapsed - leadIn));

  // Sample the clock: immediately whenever it changes, then on a cadence
  // while it is running. Reaching the end does not pause the clock, so the
  // sampler has to stop itself — and the stop condition has to be checked
  // against the value the tick just computed, because `elapsed` in this
  // closure is whatever it was when the effect last ran.
  useEffect(() => {
    const read = () => {
      const e = clockElapsed(clock, Date.now());
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

  // EMOM: is this minute's work done? Then the rest of the minute is rest.
  const emom = config.emom !== undefined;
  const station = step?.emom?.block === "station";
  const phase = step ? emomPhase(step, elapsed - step.at, doneMarks[stepIdx]) : "rest";
  const restingIn = station && phase === "rest" && !done ? stepIdx : -1;

  // The next two steps — rest included, because with 10 s rests the useful
  // lookahead is "rest, then push-ups". A flow's moves are just the way
  // into the next pose, so its lookahead is the next two poses.
  const flow = config.sequence !== undefined;
  const upNext = useMemo(
    () => (flow
      // During a move the pose being moved into is already on screen.
      ? steps.slice(stepIdx + (steps[stepIdx]?.kind === "rest" ? 2 : 1)).filter((s) => s.kind === "work").slice(0, 2)
      : steps.slice(stepIdx + 1, stepIdx + 3)),
    [steps, stepIdx, flow],
  );

  // --- Audio cues ----------------------------------------------------------
  // Cue on entering a step. Deriving the step from the clock means a long
  // standby gap lands on one step and fires one cue, never a burst.
  // A voiced workout names what comes next BEFORE it starts: the first
  // exercise in the lead-in, the next one as each rest (or, in a flow, each
  // move between poses) begins. The work itself starts on a beep.
  const voiceRole = config.voice;
  const voiced = voiceRole !== undefined;
  const [voiceOn, setVoiceOn] = useState(loadVoiceOn);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Generated clips for this workout, decoded before the first cue so every
  // line plays the instant its step begins. Lines without a clip fall back
  // to the phone's voice, and the player says how many.
  const [clips, setClips] = useState<{ buffers: Map<string, AudioBuffer>; missing: string[] } | null>(
    voiced ? null : { buffers: new Map(), missing: [] },
  );
  useEffect(() => {
    if (!voiceRole) return;
    let alive = true;
    const lines = stepLines(steps);
    prepareClips(voiceRole, lines).then(
      (r) => { if (alive) setClips(r); },
      () => { if (alive) setClips({ buffers: new Map(), missing: lines }); },
    );
    return () => { alive = false; };
  }, [voiceRole, steps]);
  // Speak a line, or give the step its beep when there is no line to say.
  const say = useCallback((line: string, beep: () => void) => {
    if (!line) {
      beep();
      return;
    }
    const clip = clips?.buffers.get(line);
    if (clip && playClip(clip)) return;
    speak(line).then(
      () => { setVoiceError(null); },
      (e: unknown) => {
        // Say why there is no voice, and still give the step a sound.
        setVoiceError(e instanceof Error ? e.message : String(e));
        beep();
      },
    );
  }, [clips]);
  const cuedStep = useRef(voiced ? -1 : 0);
  useEffect(() => {
    if (voiced && voiceOn && !clips) return; // wait for the clips: speak properly, once
    if (cuedStep.current === stepIdx) return;
    cuedStep.current = stepIdx;
    const s = steps[stepIdx];
    if (!s) {
      cueFinish();
      return;
    }
    // The beep a step gets without a spoken line. A flow's hold starts on a
    // soft tone, a circuit's work on the two rising beeps.
    const beep = () => {
      if (s.kind === "work") {
        if (flow) cueRest();
        else cueWork();
      } else if (s.kind === "rest") {
        cueRest();
      }
    };
    say(voiced && voiceOn ? cueLine(s) : "", beep);
  }, [stepIdx, steps, flow, voiced, voiceOn, clips, say]);

  // EMOM: the moment a station's work ends — Done, or its timed target
  // ran out — the rest of the minute begins: the low rest tone, or the
  // voice naming what the next minute starts with.
  const cuedRest = useRef(-1);
  useEffect(() => {
    if (restingIn < 0 || cuedRest.current === restingIn) return;
    if (voiced && voiceOn && !clips) return;
    cuedRest.current = restingIn;
    say(voiced && voiceOn ? restLine(steps, restingIn) : "", cueRest);
  }, [restingIn, steps, voiced, voiceOn, clips, say]);

  const cuedTick = useRef("");
  useEffect(() => {
    // A flow counts down into each hold — the lead-in and every move — but
    // holds end quietly: the next line names what comes after.
    if (flow && steps[stepIdx]?.kind === "work") return;
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
    advanceProgress(progress.current, steps, clockElapsed(clock, now));
    progress.current.position = Math.max(0, seconds);
    setRecordedDuration(progress.current.duration);
    // Going back to a station replays its minute from the top: its Done
    // no longer holds, and its rest is cued again when it comes.
    const target = stepIndexAt(steps, Math.max(0, seconds));
    setDoneMarks((m) => Object.fromEntries(Object.entries(m).filter(([i]) => Number(i) < target)));
    if (cuedRest.current >= target) cuedRest.current = -1;
    setClock(seekClock(clock, now, seconds));
  }, [clock, steps]);

  /** EMOM: the reps are in. The clock runs on; the rest of the minute is rest. */
  const markDone = () => {
    const into = clockElapsed(clock, Date.now()) - (steps[stepIdx]?.at ?? 0);
    setDoneMarks((m) => ({ ...m, [stepIdx]: Math.max(0, into) }));
  };

  const togglePause = useCallback(() => {
    // Resuming is a user gesture, and it is the moment a context suspended
    // by audio-focus loss (an incoming call mid-workout) can be revived.
    unlockAudio();
    const now = Date.now();
    setClock((c) => togglePauseClock(c, now));
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
  const hr = useHeartRate(config.title ?? "Workout", done, withHr);
  const attachHr = hr.attach;

  const logSession = useCallback(() => {
    const doneAt = steps.map((_, i) => doneMarks[i]);
    const session = attachHr(recordedSession(config, steps, { ...progress.current, doneAt }, startedAt, stoppedEarly));
    if (session.entries.length === 0) return null;
    update((d) => upsertSession(d, session));
    return session.id;
  }, [config, steps, doneMarks, startedAt, stoppedEarly, update, attachHr]);

  /** Start over from the lead-in: nothing recorded so far is kept. */
  const restart = () => {
    progress.current = newWodProgress();
    cuedStep.current = voiced ? -1 : 0;
    cuedRest.current = -1;
    cuedTick.current = "";
    wasAutoPaused.current = false;
    setDoneMarks({});
    setRecordedDuration(0);
    setHasWork(false);
    setConfirmStop(false);
    unlockAudio();
    const now = Date.now();
    setStartedAt(new Date(now).toISOString());
    setClock({ anchor: now, pausedAt: null });
  };

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

  const resting = emom ? phase === "rest" : step.kind !== "work";
  const em = step.emom;
  // EMOM labels: where in the workout, and what this moment is.
  const where = em?.block === "warmup"
    ? `${String(em.position)}/${String(em.of)}`
    : em
    ? `Round ${String(step.round)}/${String(config.rounds)} · ${String(em.position)}/${String(em.of)}`
    : config.sequence
    ? `Pose ${String(step.round)}/${String(config.sequence.length)}`
    : `Round ${String(step.round)}/${String(config.rounds)}`;
  const phaseLabel = em?.block === "warmup"
    ? "Warm-up"
    : em
    ? (phase === "rest" ? "Rest" : "Work")
    : flow && step.kind === "work" ? "Hold" : flow && step.kind === "rest" ? "Move to" : PHASE_LABEL[step.kind];
  // In a station's rest the figure stands still, like any rest.
  const shown: Step = emom && resting && step.kind === "work" ? { ...step, kind: "rest" } : step;
  const stepFrac = step.secs > 0 ? 1 - remain / step.secs : 1;

  return (
    <div className={`wod ${resting ? "resting" : ""} ${emom ? "emom" : ""}`}>
      <div className="wod-top">
        <TopTitle
          hr={hr}
          // An EMOM shows where it is in the centre, where a long title
          // cannot ellipsise it away.
          title={emom ? config.title ?? "EMOM" : `${config.title ? `${config.title} · ` : ""}${where}`}
        />
        <span className="chip">
          {emom
            ? `${formatSeconds(workTotal - workElapsed)} left`
            : `${formatSeconds(workElapsed)} / ${formatSeconds(workTotal)}`}
        </span>
        <Slot>{voiced && (
          <button
            className={`check music ${voiceOn ? "on" : ""}`}
            aria-label={voiceOn ? "Stop the spoken cues" : "Speak the cues"}
            onClick={() => {
              const next = !voiceOn;
              setVoiceOn(next);
              saveVoiceOn(next);
              if (!next) setVoiceError(null);
            }}
          >
            <IconVoice />
          </button>
        )}</Slot>
        <Slot>{track.musicButton}</Slot>
        <button className="check" onClick={openConfirmStop} aria-label="Stop">
          <IconClose />
        </button>
      </div>

      <div className="wod-progress" aria-hidden>
        <div style={{ width: `${String((workElapsed / workTotal) * 100)}%` }} />
      </div>

      <div className="wod-center">
        <div className="wod-phase-row">
          <div className="wod-phase">{phaseLabel}</div>
        </div>
        {emom && step.kind === "work" && <div className="wod-where">{where}</div>}
        <div className={`wod-time ${remain <= 3 ? "urgent" : ""}`}>
          {formatSeconds(remain)}
        </div>

        <div className="wod-anim">
          <ExerciseAnim anim={stepAnim(shown, flow)} size={170} mirror={stepMirror(shown, flow)} />
        </div>
        <div className="wod-exname">{stepTitle(shown, flow)}</div>
        {em && step.kind === "work" && (
          <div className="wod-target">{resting ? `${step.exercise?.name ?? "Station"} · done` : em.target}</div>
        )}
        {(flow || (em && !resting && step.kind === "work")) && step.exercise && (
          <ul className="wod-cues">
            {libraryFor(step.exercise).cues.slice(0, flow ? 2 : 1).map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {voiced && voiceOn && voiceError && (
          <div className="wod-voice-error">Voice unavailable: {voiceError}</div>
        )}
        {voiced && voiceOn && step.kind === "ready" && clips && clips.missing.length > 0 && (
          <div className="wod-voice-note">
            {voiceConfigured()
              ? `Phone voice for ${String(clips.missing.length)} line${clips.missing.length === 1 ? "" : "s"}. Generate them in Settings → Voice.`
              : "Phone voice. Add your kie.ai key in Skipan for a natural one."}
          </div>
        )}

        <div className="wod-stepbar" aria-hidden>
          <div style={{ width: `${String(stepFrac * 100)}%` }} />
        </div>
      </div>

      <div className="wod-queue">
        <div className="wod-queue-label">Up next</div>
        {upNext.length === 0 ? (
          <div className="wod-queue-row last">
            <span className="wod-queue-name">Last station: empty the tank</span>
          </div>
        ) : (
          upNext.map((s, i) => (
            <div
              key={`${String(stepIdx)}-${String(i)}`}
              className={`wod-queue-row ${s.kind === "work" ? "" : "is-rest"} ${i > 0 ? "dim" : ""}`}
            >
              <div className="wod-queue-anim">
                <ExerciseAnim anim={stepAnim(s, flow)} size={38} mirror={stepMirror(s, flow)} />
              </div>
              <span className="wod-queue-name">{stepTitle(s, flow)}</span>
              <span className="wod-queue-secs">{stepAmount(s)}</span>
            </div>
          ))
        )}
      </div>

      {track.audioElement}

      <div className="wod-controls">
        {emom && (
          // Always in an EMOM's layout so the transport never jumps; only
          // live while a station's work is still going.
          <button
            className="btn primary wod-done"
            disabled={!station || resting || paused}
            onClick={markDone}
          >
            {resting ? "Resting" : "Done"}
          </button>
        )}
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
            {/* Its own row: three across overflowed the card at the phone's text size. */}
            <button className="btn ghost" style={{ marginTop: 12 }} onClick={restart}>
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
