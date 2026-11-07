import type { Exercise, SessionEntry, Side } from "../types";
import { newSession, uid } from "./store";
import { formatSeconds } from "./units";

/** A flow step, resolved: every pose its own length, maybe one-sided. */
export interface SequenceStep {
  exercise: Exercise;
  secs: number;
  side?: Side | undefined;
}

export interface WodConfig {
  exercises: Exercise[];
  /**
   * A flow (yoga): explicit steps with their own lengths, no rests. When set,
   * it replaces the work/rest/rounds circuit, and the player speaks each pose
   * and shows its form cues.
   */
  sequence?: SequenceStep[] | undefined;
  work: number; // seconds
  rest: number; // seconds
  rounds: number;
  title?: string; // template name; falls back to "WOD work/rest"
  trackKey?: string; // battle-track cache key — plays during the WOD if cached
}

export type StepKind = "ready" | "work" | "rest";

export interface Step {
  kind: StepKind;
  /** The station this step is about. For rest/ready: the one coming up. */
  exercise: Exercise | undefined;
  round: number; // 1-based; for rest, the round the NEXT station belongs to. In a flow: the pose number.
  secs: number;
  at: number; // seconds from workout start
  side?: Side | undefined;
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
    const first = cfg.sequence[0];
    push({ kind: "ready", exercise: first?.exercise, round: 1, secs: READY_SECS, side: first?.side });
    cfg.sequence.forEach((s, i) => {
      push({ kind: "work", exercise: s.exercise, round: i + 1, secs: s.secs, side: s.side });
    });
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

/** Track only time actually traversed; seeks move position without adding work. */
export interface WodProgress {
  position: number;
  duration: number; // excludes ready, pauses and skipped time; includes rests
  work: number[]; // seconds spent in each work step, including any replay
}

export function newWodProgress(): WodProgress {
  return { position: 0, duration: 0, work: [] };
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
    const seconds = progress.work[index] ?? 0;
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
  const planned = config.sequence
    ? `planned ${String(config.sequence.length)}-pose flow`
    : `planned ${String(config.rounds)} rounds of ${String(config.work)}s on / ${String(config.rest)}s off`;
  session.note = `${stoppedEarly ? "Stopped early" : "Finished"} · ${formatSeconds(progress.duration)} recorded · ${String(stations)} ${config.sequence ? "poses" : "station intervals"} · ${planned}`;
  return session;
}
