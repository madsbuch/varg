/**
 * Fullscreen interval-WOD player: work/rest cycles with audio cues and
 * the current exercise's animation front and center.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Exercise } from "../types";
import { useApp } from "../lib/app-context";
import { newSession, uid, upsertSession } from "../lib/store";
import { libraryFor } from "../lib/library";
import { cueFinish, cueRest, cueTick, cueWork } from "../lib/beep";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose } from "./icons";
import { formatSeconds } from "../lib/units";

export interface WodConfig {
  exercises: Exercise[];
  work: number; // seconds
  rest: number; // seconds
  rounds: number;
}

interface Step {
  kind: "ready" | "work" | "rest";
  exIdx: number; // exercise shown (for rest: the NEXT exercise)
  round: number; // 1-based
  secs: number;
}

function buildSteps(cfg: WodConfig): Step[] {
  const steps: Step[] = [
    { kind: "ready", exIdx: 0, round: 1, secs: 5 },
  ];
  for (let r = 1; r <= cfg.rounds; r++) {
    cfg.exercises.forEach((_, i) => {
      steps.push({ kind: "work", exIdx: i, round: r, secs: cfg.work });
      const isVeryLast = r === cfg.rounds && i === cfg.exercises.length - 1;
      if (!isVeryLast && cfg.rest > 0) {
        const nextIdx = (i + 1) % cfg.exercises.length;
        steps.push({ kind: "rest", exIdx: nextIdx, round: r, secs: cfg.rest });
      }
    });
  }
  return steps;
}

const PHASE_LABEL: Record<Step["kind"], string> = {
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
  const [stepIdx, setStepIdx] = useState(0);
  const [display, setDisplay] = useState(steps[0].secs);
  const [paused, setPaused] = useState(false);
  const [logged, setLogged] = useState(false);
  const remainMs = useRef(steps[0].secs * 1000);
  const lastSecs = useRef(steps[0].secs);

  const done = stepIdx >= steps.length;
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const exercise = config.exercises[step.exIdx];

  // Keep the screen awake while the player is open (best effort).
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((s) => (sentinel = s))
      .catch(() => {});
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, []);

  // Reset the clock whenever the step changes.
  useEffect(() => {
    const s = steps[stepIdx];
    if (!s) return;
    remainMs.current = s.secs * 1000;
    lastSecs.current = s.secs;
    setDisplay(s.secs);
  }, [stepIdx, steps]);

  // The ticking heart of the player.
  useEffect(() => {
    if (paused || done) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      remainMs.current -= now - last;
      last = now;
      const secs = Math.max(0, Math.ceil(remainMs.current / 1000));
      if (secs !== lastSecs.current) {
        lastSecs.current = secs;
        setDisplay(secs);
        if (secs <= 3 && secs >= 1) cueTick();
      }
      if (remainMs.current <= 0) {
        const next = stepIdx + 1;
        if (next >= steps.length) cueFinish();
        else if (steps[next].kind === "work") cueWork();
        else cueRest();
        setStepIdx(next);
      }
    }, 120);
    return () => clearInterval(id);
  }, [paused, done, stepIdx, steps]);

  const skip = () => {
    const next = stepIdx + 1;
    if (next >= steps.length) cueFinish();
    else if (steps[next].kind === "work") cueWork();
    else cueRest();
    setStepIdx(next);
  };

  const totalPlanned = useMemo(
    () => steps.reduce((a, s) => (s.kind === "ready" ? a : a + s.secs), 0),
    [steps],
  );

  const logSession = () => {
    update((d) => {
      const s = newSession(`WOD ${config.work}/${config.rest}`);
      s.note = `${config.rounds} rounds · ${config.work}s on / ${config.rest}s off`;
      s.finishedAt = new Date().toISOString();
      s.entries = config.exercises.map((ex) => ({
        id: uid("entry"),
        exerciseId: ex.id,
        sets: Array.from({ length: config.rounds }, () => ({
          id: uid("set"),
          seconds: config.work,
          done: true,
        })),
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
          <div className="wod-time">{formatSeconds(totalPlanned)}</div>
          <div className="muted" style={{ textAlign: "center" }}>
            {config.rounds} rounds · {config.exercises.length} exercises ·{" "}
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

  const working = step.kind === "work";

  return (
    <div className="wod">
      <div className="wod-top">
        <span className="chip">
          Round {step.round}/{config.rounds}
        </span>
        <button className="check" onClick={onClose} aria-label="Stop">
          <IconClose />
        </button>
      </div>

      <div className="wod-center">
        <div
          className="wod-phase"
          style={{ color: working ? "var(--accent)" : "var(--gold)" }}
        >
          {PHASE_LABEL[step.kind]}
        </div>
        <div className={`wod-time ${display <= 3 ? "urgent" : ""}`}>
          {formatSeconds(display)}
        </div>

        {exercise && (
          <>
            <div className="wod-anim">
              <ExerciseAnim anim={libraryFor(exercise).anim} size={190} />
            </div>
            <div className="wod-exname">
              {step.kind === "rest" && (
                <span className="faint" style={{ fontWeight: 400 }}>
                  Next:{" "}
                </span>
              )}
              {exercise.name}
            </div>
          </>
        )}
      </div>

      <div className="wod-controls">
        <div className="btn-row">
          <button className="btn" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn ghost" onClick={skip}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
