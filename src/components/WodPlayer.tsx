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

// buildSteps always yields at least the "ready" step; this fallback only
// exists to satisfy checked index access.
const FALLBACK_STEP: Step = { kind: "ready", exIdx: 0, round: 1, secs: 5 };

export default function WodPlayer({
  config,
  onClose,
}: {
  config: WodConfig;
  onClose: () => void;
}) {
  const { update } = useApp();
  const steps = useMemo(() => buildSteps(config), [config]);
  const firstStep = steps[0] ?? FALLBACK_STEP;
  const [stepIdx, setStepIdx] = useState(0);
  const [display, setDisplay] = useState(firstStep.secs);
  const [paused, setPaused] = useState(false);
  const [logged, setLogged] = useState(false);
  const remainMs = useRef(firstStep.secs * 1000);
  const lastSecs = useRef(firstStep.secs);

  const done = stepIdx >= steps.length;
  const step = steps[Math.min(stepIdx, steps.length - 1)] ?? FALLBACK_STEP;
  const exercise = config.exercises[step.exIdx];

  // Battle track: play the workout's cached track under the cues. While
  // the track is still composing, keep checking so it joins mid-workout.
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

  // The next two blocks, so "what's next" is always on screen. Rest is a
  // block like any other, so it shows up here by name too.
  const upNext = useMemo(() => {
    const labels: string[] = [];
    for (let i = stepIdx + 1; i < steps.length && labels.length < 2; i++) {
      const s = steps[i];
      if (s?.kind === "work") {
        const ex = config.exercises[s.exIdx];
        if (ex) labels.push(ex.name);
      } else if (s?.kind === "rest") labels.push("Rest");
    }
    return labels;
  }, [stepIdx, steps, config.exercises]);

  // Keep the screen awake while the player is open (best effort).
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    if ("wakeLock" in navigator) {
      navigator.wakeLock
        .request("screen")
        .then((s) => {
          sentinel = s;
        })
        .catch(() => undefined);
    }
    return () => {
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  // Advance to a step: cue it, reset the clock, update state. Called from
  // the tick interval and the Skip button — never from an effect body.
  const advance = (next: number) => {
    const s = steps[next];
    if (!s) cueFinish();
    else if (s.kind === "work") cueWork();
    else cueRest();
    if (s) {
      remainMs.current = s.secs * 1000;
      lastSecs.current = s.secs;
      setDisplay(s.secs);
    }
    setStepIdx(next);
  };

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
      if (remainMs.current <= 0) advance(stepIdx + 1);
    }, 120);
    return () => { clearInterval(id); };
  });

  const skip = () => { advance(stepIdx + 1); };

  const totalPlanned = useMemo(
    () => steps.reduce((a, s) => (s.kind === "ready" ? a : a + s.secs), 0),
    [steps],
  );

  const logSession = () => {
    update((d) => {
      const s = newSession(config.title ?? `WOD ${config.work}/${config.rest}`);
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
          {config.title ? `${config.title} · ` : ""}Round {step.round}/
          {config.rounds}
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
              <ExerciseAnim
                anim={step.kind === "rest" ? "rest" : libraryFor(exercise).anim}
                size={190}
              />
            </div>
            <div className="wod-exname">
              {step.kind === "rest" ? "Rest" : exercise.name}
            </div>
            <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>
              {upNext.length === 0
                ? "Last station — empty the tank"
                : `Next: ${upNext.join(" · Then: ")}`}
            </div>
          </>
        )}
      </div>

      {trackUrl && <audio ref={audioRef} src={trackUrl} loop autoPlay />}

      <div className="wod-controls">
        <div className="btn-row">
          <button className="btn" onClick={() => { setPaused((p) => !p); }}>
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
