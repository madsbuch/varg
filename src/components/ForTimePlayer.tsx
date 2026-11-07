/**
 * Fullscreen for-time player: a fixed amount of work against a running
 * stopwatch (Murph, DT, Chad 1000x).
 *
 * The athlete sees the stopwatch, the stage they are on with its target
 * ("100 pull-ups"), and the next two stages. One big Done button closes
 * the current stage; the clock reading at each tap is the only state, and
 * splits, the total and the logged session are all derived from it.
 *
 * Timing is anchored to the wall clock, like the interval player: Android
 * freezes the WebView in standby, and a run that takes an hour will see
 * the screen lock at some point.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { deleteSession, upsertSession } from "../lib/store";
import {
  bestForTime,
  FOR_TIME_READY_SECS,
  recordedForTimeSession,
  splitsFrom,
} from "../lib/fortime";
import type { ForTimeConfig } from "../lib/fortime";
import { libraryFor } from "../lib/library";
import { useBackHandler } from "../lib/back";
import { cueFinish, cueTick, cueWork, unlockAudio } from "../lib/beep";
import { formatSeconds } from "../lib/units";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose } from "./icons";
import { useBattleTrack, useWorkoutWakeLock } from "./battle-track";
import type { GpsStatus } from "../lib/gps";
import { formatPace, gpsAvailable, loadGpsEnabled, runStatus, startRun, stopRun } from "../lib/gps";

/** GPS for one stage: the tracker's latest status, or why it is not running. */
interface StageGps {
  stageIdx: number;
  status?: GpsStatus;
  error?: string;
}

interface Clock {
  anchor: number; // ms timestamp where raw elapsed == 0 (start of the lead-in)
  pausedAt: number | null;
}

/** Workout-clock seconds (lead-in excluded) at a given wall-clock moment. */
function workAt(clock: Clock, now: number): number {
  const raw = ((clock.pausedAt ?? now) - clock.anchor) / 1000;
  return Math.max(0, raw - FOR_TIME_READY_SECS);
}

export default function ForTimePlayer({
  config,
  onClose,
}: {
  config: ForTimeConfig;
  onClose: () => void;
}) {
  const { data, update } = useApp();
  const stages = config.stages;

  const [clock, setClock] = useState<Clock>(() => ({ anchor: Date.now(), pausedAt: null }));
  const [raw, setRaw] = useState(0); // seconds since the lead-in started
  const [marks, setMarks] = useState<number[]>([]);
  const [startedAt] = useState(() => new Date().toISOString());
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const loggedId = useRef<string | null>(null);
  const [discarded, setDiscarded] = useState(false);

  const paused = clock.pausedAt !== null;
  const finished = marks.length === stages.length;
  const done = finished || stoppedAt !== null;
  const ready = raw < FOR_TIME_READY_SECS;
  const work = Math.max(0, raw - FOR_TIME_READY_SECS);

  // Sample the wall clock while running. Date.now() is only ever read in
  // effects and handlers, never during render.
  useEffect(() => {
    if (done) return;
    const read = () => { setRaw(((clock.pausedAt ?? Date.now()) - clock.anchor) / 1000); };
    read();
    if (clock.pausedAt !== null) return;
    const id = setInterval(read, 200);
    return () => { clearInterval(id); };
  }, [clock, done]);

  const stageIdx = Math.min(marks.length, stages.length - 1);
  const stage = stages[stageIdx];
  const exercise = config.exercises[stageIdx];
  const stageStart = marks[marks.length - 1] ?? 0;

  // --- GPS (optional, run stages only) ---------------------------------------
  // The native tracker measures while the phone is locked and records when
  // the target was reached; this side starts and stops it per stage, polls
  // it whenever the WebView is awake, and turns a crossing into a Done at
  // the moment it happened — not the moment the phone was unlocked.
  const [gpsOn] = useState(() => gpsAvailable() && loadGpsEnabled());
  const [gps, setGps] = useState<StageGps | null>(null);
  const [measured, setMeasured] = useState<Record<number, number>>({});
  /** Stages reopened by Undo: measure on, but never auto-complete again. */
  const [reopened, setReopened] = useState<ReadonlySet<number>>(new Set());
  const isGpsStage =
    gpsOn && !ready && !done && stage?.meters != null && exercise?.metric === "distance_time";
  const gpsStageIdx = isGpsStage ? stageIdx : -1;
  const gpsTarget = isGpsStage && !reopened.has(stageIdx) ? (stage.meters ?? 0) : 0;
  const gpsResumeFrom = isGpsStage ? (measured[stageIdx] ?? 0) : 0;

  // The poll callbacks need the current clock; a ref keeps the tracker
  // effect from restarting (and resetting the distance) on every pause.
  const clockRef = useRef(clock);
  useEffect(() => { clockRef.current = clock; }, [clock]);

  useEffect(() => {
    if (gpsStageIdx < 0) return;
    let alive = true;
    const idx = gpsStageIdx;
    const target = gpsTarget;
    const apply = (status: GpsStatus) => {
      if (!alive) return;
      setGps({ stageIdx: idx, status });
      if (target <= 0 || !status.crossedAtMs) return;
      // Auto-Done at the moment the distance was reached, on the workout
      // clock — clamped between this stage's start and now.
      const now = workAt(clockRef.current, Date.now());
      const crossed = workAt(clockRef.current, status.crossedAtMs);
      setMarks((prev) =>
        prev.length === idx ? [...prev, Math.min(now, Math.max(prev[idx - 1] ?? 0, crossed))] : prev,
      );
      setMeasured((prev) => (prev[idx] != null ? prev : { ...prev, [idx]: status.meters }));
    };
    const poll = () => {
      runStatus()
        .then(apply)
        .catch((e: unknown) => { if (alive) setGps({ stageIdx: idx, error: String(e instanceof Error ? e.message : e) }); });
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    startRun(target, gpsResumeFrom)
      .then((status) => {
        if (!alive) return;
        apply(status);
        timer = setInterval(poll, 1000);
      })
      .catch((e: unknown) => {
        if (alive) setGps({ stageIdx: idx, error: String(e instanceof Error ? e.message : e) });
      });
    // Coming back from a locked screen: read at once, so a crossing that
    // happened in the pocket is applied before the athlete looks.
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void stopRun().catch(() => undefined);
    };
  }, [gpsStageIdx, gpsTarget, gpsResumeFrom]);

  const stageGps = gps?.stageIdx === stageIdx && isGpsStage ? gps : null;
  const gpsMeters = stageGps?.status?.meters;

  const total = finished ? (marks[marks.length - 1] ?? 0) : (stoppedAt ?? work);

  // --- Cues ------------------------------------------------------------------
  // Countdown ticks in the lead-in, the work cue as the clock starts and as
  // each new stage begins, the finish cue on the last Done. Undo is silent.
  const readyRemain = Math.ceil(FOR_TIME_READY_SECS - raw);
  const cuedTick = useRef(0);
  useEffect(() => {
    if (!ready || paused || readyRemain > 3 || readyRemain < 1) return;
    if (cuedTick.current === readyRemain) return;
    cuedTick.current = readyRemain;
    cueTick();
  }, [ready, paused, readyRemain]);

  const cuedStage = useRef(-1); // -1: lead-in
  useEffect(() => {
    const at = ready ? -1 : marks.length;
    if (at <= cuedStage.current) {
      cuedStage.current = at; // undo or nothing new: no sound
      return;
    }
    cuedStage.current = at;
    if (at === stages.length) cueFinish();
    else cueWork();
  }, [ready, marks.length, stages.length]);

  // --- Transport -------------------------------------------------------------
  const completeStage = () => {
    if (paused || done) return;
    const now = Date.now();
    const t = workAt(clock, now);
    if (t <= 0) return; // still in the lead-in
    setMarks((m) => (m.length < stages.length ? [...m, t] : m));
    if (gpsMeters != null) {
      const idx = stageIdx;
      const m = gpsMeters;
      setMeasured((prev) => ({ ...prev, [idx]: m }));
    }
  };

  const undo = () => {
    // Reopening a GPS stage carries on from its measured distance, with
    // auto-Done off — it already fired once, or was overridden by hand.
    const idx = marks.length - 1;
    if (idx < 0) return;
    if (measured[idx] != null) setReopened((r) => new Set(r).add(idx));
    setMarks((m) => m.slice(0, -1));
  };

  const togglePause = useCallback(() => {
    unlockAudio();
    const now = Date.now();
    setClock((c) =>
      c.pausedAt === null
        ? { ...c, pausedAt: now }
        : { anchor: c.anchor + (now - c.pausedAt), pausedAt: null },
    );
  }, []);

  // Deciding whether to stop must not cost workout time: the dialog pauses
  // the clock, and "Keep going" resumes it only if it paused it.
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

  const stopAndSave = () => {
    setStoppedAt(workAt(clock, Date.now()));
    setConfirmStop(false);
  };

  // Back never dismisses a running workout; it opens the same guard as X.
  const onBack = useCallback(() => {
    if (done) onClose();
    else if (confirmStop) keepGoing();
    else openConfirmStop();
    return true;
  }, [done, confirmStop, keepGoing, openConfirmStop, onClose]);
  useBackHandler(true, onBack);

  // --- Music & wake lock -----------------------------------------------------
  const track = useBattleTrack(config.templateId, paused, done);
  useWorkoutWakeLock(done);

  // --- Logging ---------------------------------------------------------------
  const logSession = useCallback(() => {
    if (marks.length === 0) return null;
    const session = recordedForTimeSession(config, marks, startedAt, stoppedAt ?? undefined, measured);
    update((d) => upsertSession(d, session));
    return session.id;
  }, [config, marks, startedAt, stoppedAt, update, measured]);

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

  // A mis-tapped Finish is the one tap the in-workout Undo cannot reach, so
  // the result screen offers it: un-log, reopen the last stage, and let the
  // clock — which never stopped — carry on.
  const undoFinish = () => {
    const id = loggedId.current;
    if (id !== null) update((d) => deleteSession(d, id));
    loggedId.current = null;
    setDiscarded(false);
    const idx = marks.length - 1;
    if (measured[idx] != null) setReopened((r) => new Set(r).add(idx));
    setMarks((m) => m.slice(0, -1));
  };

  const relog = () => {
    loggedId.current = logSession();
    setDiscarded(false);
  };

  // Previous best: every completed run of this template except this one,
  // which is recognised by its start time (the logged session's date).
  const sessions = data.sessions;
  const previousBest = useMemo(
    () => (done ? bestForTime(sessions, config.templateId, stages.length, startedAt) : undefined),
    [done, sessions, config.templateId, stages.length, startedAt],
  );

  const splits = splitsFrom(marks);

  // --- Completion screen -----------------------------------------------------
  if (done) {
    return (
      <div className="wod">
        <div className="wod-top">
          <span className="eyebrow">{finished ? "Mission complete" : "Workout stopped"}</span>
          <button className="check" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="wod-center fortime-result">
          <div className="wod-phase" style={{ color: "var(--gold)" }}>
            {finished ? `${config.title} — for time` : "Stopped early"}
          </div>
          <div className="wod-time">{formatSeconds(total)}</div>
          <div className="muted" style={{ textAlign: "center" }}>
            {finished
              ? comparison(total, previousBest)
              : `${String(marks.length)} of ${String(stages.length)} stages done · partial runs never count as a best`}
          </div>
          {marks.length > 0 && (
            <ol className="fortime-splits">
              {splits.map((s, i) => (
                <li key={i}>
                  <span>
                    {stages[i]?.label}
                    {measured[i] != null && (
                      <span className="muted"> · GPS {((measured[i] ?? 0) / 1000).toFixed(2)} km</span>
                    )}
                  </span>
                  <span className="fortime-split">{formatSeconds(s)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="wod-controls">
          {marks.length === 0 ? (
            <div className="muted">No stages completed — nothing logged.</div>
          ) : discarded ? (
            <button className="btn primary" onClick={relog}>
              Log as session
            </button>
          ) : (
            <>
              <div className="chip accent" style={{ margin: "0 auto" }}>
                <IconCheck style={{ width: 14, height: 14 }} /> Logged to history
              </div>
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={removeLog}>
                Remove from history
              </button>
            </>
          )}
          {finished && (
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={undoFinish}>
              Tapped Finish too early? Keep going
            </button>
          )}
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!stage) return null;
  const upNext = stages.slice(stageIdx + 1, stageIdx + 3);

  return (
    <div className={`wod ${ready ? "resting" : ""}`}>
      <div className="wod-top">
        <span className="chip">
          {config.title} · Stage {stageIdx + 1}/{stages.length}
        </span>
        {track.musicButton}
        <button className="check" onClick={openConfirmStop} aria-label="Stop">
          <IconClose />
        </button>
      </div>

      <div className="wod-progress" aria-hidden>
        <div style={{ width: `${String((marks.length / stages.length) * 100)}%` }} />
      </div>

      <div className="wod-center">
        <div className="wod-phase">{ready ? "Get ready" : paused ? "Paused" : "For time"}</div>
        <div className="wod-time">
          {ready ? formatSeconds(readyRemain) : formatSeconds(work)}
        </div>

        <div className="wod-anim">
          <ExerciseAnim anim={exercise ? libraryFor(exercise).anim : "rest"} size={170} />
        </div>
        <div className="wod-exname">{stage.label}</div>
        <div className="muted fortime-stage-time">
          {ready ? "First up" : `This stage ${formatSeconds(Math.max(0, work - stageStart))}`}
        </div>
        {isGpsStage && <GpsLine gps={stageGps} seconds={Math.max(0, work - stageStart)} target={gpsTarget} />}
      </div>

      <div className="wod-queue">
        <div className="wod-queue-label">Up next</div>
        {upNext.length === 0 ? (
          <div className="wod-queue-row last">
            <span className="wod-queue-name">Last stage — empty the tank</span>
          </div>
        ) : (
          upNext.map((s, i) => {
            const ex = config.exercises[stageIdx + 1 + i];
            return (
              <div key={`${String(stageIdx)}-${String(i)}`} className={`wod-queue-row ${i > 0 ? "dim" : ""}`}>
                <div className="wod-queue-anim">
                  <ExerciseAnim anim={ex ? libraryFor(ex).anim : "rest"} size={38} />
                </div>
                <span className="wod-queue-name">{s.label}</span>
              </div>
            );
          })
        )}
      </div>

      {track.audioElement}

      <div className="wod-controls">
        <button
          className="btn primary fortime-done"
          onClick={completeStage}
          disabled={ready || paused}
        >
          <IconCheck /> {stageIdx === stages.length - 1 ? "Finish" : "Done"}
        </button>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            className="btn ghost"
            onClick={undo}
            disabled={marks.length === 0}
            aria-label="Undo last Done"
          >
            ↶
          </button>
          <button className="btn grow" onClick={togglePause}>
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      {confirmStop && (
        <div className="wod-confirm">
          <div className="card">
            <h3 style={{ fontSize: 17 }}>Stop the workout?</h3>
            <p className="muted" style={{ fontSize: 14 }}>
              {marks.length === 0
                ? "No stages done yet, so nothing would be saved."
                : `Saves the ${String(marks.length)} completed stage${marks.length === 1 ? "" : "s"} and their splits. A stopped run never counts as a best time.`}
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

function comparison(total: number, best: number | undefined): string {
  if (best == null) return "First recorded run — this is the time to beat.";
  const diff = Math.round(total - best);
  if (diff < 0) return `New best — ${formatSeconds(-diff)} faster than ${formatSeconds(best)}.`;
  if (diff === 0) return `Equal to your best, ${formatSeconds(best)}.`;
  return `${formatSeconds(diff)} behind your best of ${formatSeconds(best)}.`;
}

/** The run stage's GPS readout — or, loudly, why there is none. */
function GpsLine({ gps, seconds, target }: { gps: StageGps | null; seconds: number; target: number }) {
  if (!gps) return <div className="fortime-gps muted">GPS starting…</div>;
  if (gps.error) {
    return <div className="fortime-gps bad">GPS off: {gps.error} Tap Done yourself.</div>;
  }
  const st = gps.status;
  if (!st) return <div className="fortime-gps muted">GPS starting…</div>;
  if (st.error) return <div className="fortime-gps bad">GPS: {st.error} Tap Done yourself.</div>;
  const km = (st.meters / 1000).toFixed(2);
  const goal = target > 0 ? ` / ${(target / 1000).toFixed(2)} km` : " km";
  const pace = formatPace(seconds, st.meters);
  const searching = st.lastAccuracy < 0 || st.lastAccuracy > 25;
  return (
    <div className="fortime-gps">
      GPS {km}{goal}
      {pace && ` · ${pace}`}
      {searching && <span className="muted"> · searching for signal…</span>}
      {target <= 0 && <span className="muted"> · tap Done when finished</span>}
    </div>
  );
}
