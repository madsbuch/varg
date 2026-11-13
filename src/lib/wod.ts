import type { Exercise, SessionEntry, Side, Template } from "../types";
import { newSession, uid } from "./store";
import { formatSeconds } from "./units";

/** A flow step, resolved: every pose its own length, maybe one-sided. */
export interface SequenceStep {
  exercise: Exercise;
  secs: number;
  side?: Side | undefined;
}

/** Which voice speaks a workout's cues: calm for yoga, firm for training. */
export type VoiceRole = "yoga" | "workout";

export interface WodConfig {
  exercises: Exercise[];
  /** Spoken cues ("Next: push-ups") in this voice; none when unset. */
  voice?: VoiceRole | undefined;
  /** Flows: seconds to move between poses (and the lead-in). */
  transition?: number | undefined;
  /**
   * A flow (yoga): explicit steps with their own lengths, no rests. When set,
   * it replaces the work/rest/rounds circuit, and the player speaks each pose
   * and shows its form cues.
   */
  sequence?: SequenceStep[] | undefined;
  /**
   * An EMOM: one station per minute, round after round, after an optional
   * warm-up. When set, it replaces the work/rest circuit (work is the
   * minute, rest is 0) and every station step carries its target.
   */
  emom?: EmomConfig | undefined;
  work: number; // seconds
  rest: number; // seconds
  rounds: number;
  title?: string; // template name; falls back to "WOD work/rest"
  trackKey?: string; // battle-track cache key — plays during the WOD if cached
}

/** An EMOM station with its exercise resolved. */
export interface EmomStationConfig {
  exercise: Exercise;
  reps?: [number, number] | undefined;
  seconds?: [number, number] | undefined;
  target: string;
}

export interface EmomConfig {
  minute: number;
  stations: EmomStationConfig[];
  warmup: { exercise: Exercise; secs: number }[];
}

export type StepKind = "ready" | "work" | "rest";

/**
 * What an EMOM step adds to a plain work step. A warm-up step is all
 * work. A station owns its whole minute: work until Done (reps) or until
 * `workSecs` have run (timed), then the rest of the minute is rest.
 */
export interface EmomStep {
  block: "warmup" | "station";
  /** 1-based position in its block: warm-up 1/3, station 1/6. */
  position: number;
  of: number;
  /** What to do, as the athlete reads it: "8–12 reps", "40 s". */
  target: string;
  /** Timed station: seconds of work before rest shows by itself. */
  workSecs?: number | undefined;
  /** Rep station: the athlete taps Done when the reps are in. */
  reps?: [number, number] | undefined;
}

export interface Step {
  kind: StepKind;
  /** The station this step is about. For rest/ready: the one coming up. */
  exercise: Exercise | undefined;
  round: number; // 1-based; for rest, the round the NEXT station belongs to. In a flow: the pose number.
  secs: number;
  at: number; // seconds from workout start
  side?: Side | undefined;
  emom?: EmomStep | undefined;
}

export const READY_SECS = 5;

/**
 * Expand a config into the flat list of steps, each stamped with its
 * absolute offset so the current step is a lookup, not a countdown.
 */
export function buildSteps(cfg: WodConfig): Step[] {
  const steps: Step[] = [];
  let at = 0;
  const push = (s: Omit<Step, "at">) => {
    steps.push({ ...s, at });
    at += s.secs;
  };

  if (cfg.sequence) {
    // A flow: lead-in, then hold / move / hold … The move between poses is
    // a rest step that already belongs to the NEXT pose — that is what the
    // athlete is getting into, and what the voice names.
    const move = cfg.transition ?? 0;
    const first = cfg.sequence[0];
    push({ kind: "ready", exercise: first?.exercise, round: 1, secs: move > 0 ? move : READY_SECS, side: first?.side });
    cfg.sequence.forEach((s, i) => {
      if (i > 0 && move > 0) push({ kind: "rest", exercise: s.exercise, round: i + 1, secs: move, side: s.side });
      push({ kind: "work", exercise: s.exercise, round: i + 1, secs: s.secs, side: s.side });
    });
    return steps;
  }

  if (cfg.emom) {
    // An EMOM: lead-in, the warm-up back to back, then one step per
    // station per round, each exactly a minute long. The work/rest split
    // inside the minute is the athlete's (Done) or the target's (timed),
    // so it is a phase of the step, not a step of its own: the minute
    // boundaries can never move.
    const { minute, stations, warmup } = cfg.emom;
    push({ kind: "ready", exercise: warmup[0]?.exercise ?? stations[0]?.exercise, round: 1, secs: READY_SECS });
    warmup.forEach((w, i) => {
      push({
        kind: "work", exercise: w.exercise, round: 1, secs: w.secs,
        emom: { block: "warmup", position: i + 1, of: warmup.length, target: `${String(w.secs)} s` },
      });
    });
    for (let r = 1; r <= cfg.rounds; r++) {
      stations.forEach((st, i) => {
        push({
          kind: "work", exercise: st.exercise, round: r, secs: minute,
          emom: {
            block: "station", position: i + 1, of: stations.length, target: st.target,
            workSecs: st.seconds ? Math.min(minute, st.seconds[1]) : undefined,
            reps: st.reps,
          },
        });
      });
    }
    return steps;
  }

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
 * The guided-player config for a template, or the reason it cannot run.
 * Used by the Hunt screen to start a workout and by the voice generator to
 * know every line the player will speak — one definition, so the two
 * cannot drift apart. Never runs a short version: every station or pose
 * must resolve.
 */
export function configForTemplate(tpl: Template, exById: Map<string, Exercise>): WodConfig | string {
  const missing = (have: number, want: number, what: string) =>
    `${tpl.name} needs ${String(want)} ${what} but only ${String(have)} exist on this device. ` +
    `Reinstalling or updating the app restores the built-in exercises.`;
  if (tpl.flow) {
    const sequence = tpl.flow.steps.flatMap((st) => {
      const exercise = exById.get(st.exerciseId);
      return exercise ? [{ exercise, secs: st.seconds, side: st.side }] : [];
    });
    if (sequence.length !== tpl.flow.steps.length) return missing(sequence.length, tpl.flow.steps.length, "poses");
    return {
      exercises: sequence.map((s) => s.exercise),
      sequence,
      transition: tpl.flow.transition,
      work: 0, rest: 0, rounds: 1,
      title: tpl.name, trackKey: tpl.id, voice: "yoga",
    };
  }
  if (tpl.emom) {
    const plan = tpl.emom;
    const resolve = (id: string) => exById.get(id);
    const stations = plan.stations.flatMap((st) => {
      const exercise = resolve(st.exerciseId);
      return exercise ? [{ exercise, reps: st.reps, seconds: st.seconds, target: st.target }] : [];
    });
    if (stations.length !== plan.stations.length) return missing(stations.length, plan.stations.length, "stations");
    const wantWarmup = plan.warmup ?? [];
    const warmup = wantWarmup.flatMap((w) => {
      const exercise = resolve(w.exerciseId);
      return exercise ? [{ exercise, secs: w.seconds }] : [];
    });
    if (warmup.length !== wantWarmup.length) return missing(warmup.length, wantWarmup.length, "warm-up exercises");
    return {
      exercises: stations.map((s) => s.exercise),
      emom: { minute: plan.minute, stations, warmup },
      work: plan.minute, rest: 0, rounds: plan.rounds,
      title: tpl.name, trackKey: tpl.id, voice: "workout",
    };
  }
  if (tpl.interval) {
    const exercises = tpl.exerciseIds.flatMap((id) => {
      const ex = exById.get(id);
      return ex ? [ex] : [];
    });
    if (exercises.length !== tpl.exerciseIds.length) return missing(exercises.length, tpl.exerciseIds.length, "stations");
    return { exercises, ...tpl.interval, title: tpl.name, trackKey: tpl.id, voice: "workout" };
  }
  return `${tpl.name} is not a guided workout.`;
}

/**
 * Is the athlete working or resting at `into` seconds into this step? Only
 * an EMOM station splits its step: work until Done was tapped (`doneAt`,
 * seconds into the step) or its timed work has run, rest after. Every
 * other step is what its kind says.
 */
export function emomPhase(step: Step, into: number, doneAt?: number): "work" | "rest" {
  if (step.kind !== "work") return "rest";
  const e = step.emom;
  if (e?.block !== "station") return "work";
  if (doneAt !== undefined && into >= doneAt) return "rest";
  if (e.workSecs !== undefined && into >= e.workSecs) return "rest";
  return "work";
}

/**
 * Index of the step the given elapsed time falls inside. Binary search,
 * not a scan: `steps` is sorted by `at` by construction, and the player
 * runs this on every render at 10 Hz.
 */
export function stepIndexAt(steps: Step[], elapsed: number): number {
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

/**
 * The workout's position on the wall clock. Elapsed time is always read
 * from Date.now() against the anchor — never accumulated — so a WebView
 * frozen in standby comes back on the right second.
 */
export interface Clock {
  anchor: number; // ms timestamp where elapsed == 0
  pausedAt: number | null; // ms timestamp the clock is frozen at
}

export function clockElapsed(c: Clock, now: number): number {
  return Math.max(0, ((c.pausedAt ?? now) - c.anchor) / 1000);
}

/** Pause, or resume with the paused span cut out of the timeline. */
export function togglePauseClock(c: Clock, now: number): Clock {
  return c.pausedAt === null
    ? { ...c, pausedAt: now }
    : { anchor: c.anchor + (now - c.pausedAt), pausedAt: null };
}

/** Move to `seconds` into the workout, keeping a paused clock paused. */
export function seekClock(c: Clock, now: number, seconds: number): Clock {
  return { ...c, anchor: (c.pausedAt ?? now) - Math.max(0, seconds) * 1000 };
}

/** Track only time actually traversed; seeks move position without adding work. */
export interface WodProgress {
  position: number;
  duration: number; // excludes ready, pauses and skipped time; includes rests
  work: number[]; // seconds spent in each work step, including any replay
  /** EMOM: seconds into each station step at which Done was tapped. */
  doneAt: (number | undefined)[];
}

export function newWodProgress(): WodProgress {
  return { position: 0, duration: 0, work: [], doneAt: [] };
}

export function advanceProgress(progress: WodProgress, steps: Step[], elapsed: number): void {
  for (const [index, step] of steps.entries()) {
    const seconds = Math.max(0, Math.min(elapsed, step.at + step.secs) - Math.max(progress.position, step.at));
    if (step.kind !== "ready") progress.duration += seconds;
    if (step.kind === "work") progress.work[index] = (progress.work[index] ?? 0) + seconds;
  }
  progress.position = elapsed;
}

export function recordedEntries(steps: Step[], progress: WodProgress): SessionEntry[] {
  const entries = new Map<string, SessionEntry>();
  for (const [index, step] of steps.entries()) {
    let seconds = progress.work[index] ?? 0;
    // An EMOM station's rest is not work: log the time until Done, or the
    // timed target, not the whole minute.
    if (step.emom?.block === "station") {
      seconds = Math.min(seconds, progress.doneAt[index] ?? step.emom.workSecs ?? step.secs);
    }
    if (step.kind !== "work" || !step.exercise || seconds <= 0) continue;
    const ex = step.exercise;
    let entry = entries.get(ex.id);
    if (!entry) {
      entry = { id: uid("entry"), exerciseId: ex.id, sets: [] };
      entries.set(ex.id, entry);
    }
    // The timer knows duration, not reps, weight, distance or hold performance.
    // Keep sets unchecked so elapsed station time cannot manufacture PRs.
    entry.sets.push({ id: uid("set"), done: false, seconds });
  }
  return [...entries.values()];
}

export function recordedSession(
  config: WodConfig,
  steps: Step[],
  progress: WodProgress,
  startedAt: string,
  stoppedEarly: boolean,
) {
  const session = newSession(config.title ?? `WOD ${String(config.work)}/${String(config.rest)}`);
  session.date = startedAt;
  session.finishedAt = new Date().toISOString();
  if (config.trackKey) session.templateId = config.trackKey;
  session.entries = recordedEntries(steps, progress);
  const stations = session.entries.reduce((n, entry) => n + entry.sets.length, 0);
  const emom = config.emom;
  const warm = emom?.warmup.reduce((a, w) => a + w.secs, 0) ?? 0;
  const planned = emom
    ? `planned ${warm > 0 ? `${formatSeconds(warm)} warm-up + ` : ""}${String(config.rounds)} rounds of ${String(emom.stations.length)} stations EMOM`
    : config.sequence
    ? `planned ${String(config.sequence.length)}-pose flow`
    : `planned ${String(config.rounds)} rounds of ${String(config.work)}s on / ${String(config.rest)}s off`;
  session.note = `${stoppedEarly ? "Stopped early" : "Finished"} · ${formatSeconds(progress.duration)} recorded · ${String(stations)} ${config.sequence ? "poses" : emom ? "sets" : "station intervals"} · ${planned}`;
  return session;
}
