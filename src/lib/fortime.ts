/**
 * For-time workouts: a fixed amount of work, scored by how long it takes.
 *
 * The player keeps one list of "marks" — the workout clock reading, in
 * seconds, at each tap of Done. Everything else (current stage, splits,
 * total, what gets logged) is derived from that list, so there is no second
 * copy of the state to drift. The workout clock itself is wall-clock
 * anchored in the player, exactly like the interval player.
 */
import type { Exercise, ForTimeStage, Session, SessionEntry } from "../types";
import { newSession, uid } from "./store";
import { formatSeconds } from "./units";

/** Lead-in before the clock starts. */
export const FOR_TIME_READY_SECS = 5;

/** Prefix of a finished for-time session's note; how a result is recognised. */
const FINISHED = "For time · finished";
const STOPPED = "For time · stopped early";

export interface ForTimeConfig {
  title: string;
  templateId: string;
  stages: ForTimeStage[];
  /** One per stage, resolved before the player opens. */
  exercises: Exercise[];
}

/** Split of each completed stage, from the cumulative marks. */
export function splitsFrom(marks: number[]): number[] {
  return marks.map((m, i) => m - (marks[i - 1] ?? 0));
}

/**
 * The session a for-time run logs: one set per completed stage, carrying the
 * prescribed amount and the split. Sets stay unchecked, as with the interval
 * player — "100 pull-ups" in a Murph is not a 100-rep set, and checking it
 * would file it as a max-reps record.
 */
export function recordedForTimeSession(
  cfg: ForTimeConfig,
  marks: number[],
  startedAt: string,
  stoppedAt?: number,
  /** GPS-measured distance per stage index, where GPS ran. */
  measured: Record<number, number> = {},
): Session {
  const session = newSession(cfg.title);
  session.date = startedAt;
  session.finishedAt = new Date().toISOString();
  session.templateId = cfg.templateId;

  const entries = new Map<string, SessionEntry>();
  splitsFrom(marks).forEach((seconds, i) => {
    const stage = cfg.stages[i];
    if (!stage) return;
    let entry = entries.get(stage.exerciseId);
    if (!entry) {
      entry = { id: uid("entry"), exerciseId: stage.exerciseId, sets: [] };
      entries.set(stage.exerciseId, entry);
    }
    const gps = measured[i];
    entry.sets.push({
      id: uid("set"),
      done: false,
      seconds,
      reps: stage.reps,
      // What GPS measured, when it ran; otherwise the prescribed distance.
      meters: gps != null && stage.meters != null ? Math.round(gps) : stage.meters,
    });
  });
  session.entries = [...entries.values()];

  const splits = splitsFrom(marks)
    .map((s, i) => {
      const gps = measured[i];
      const km = gps != null ? ` (GPS ${(gps / 1000).toFixed(2)} km)` : "";
      return `${cfg.stages[i]?.label ?? "?"} ${formatSeconds(s)}${km}`;
    })
    .join(" · ");
  const complete = marks.length === cfg.stages.length;
  if (complete) {
    session.note = `${FINISHED} in ${formatSeconds(marks[marks.length - 1] ?? 0)} · ${splits}`;
  } else {
    const at = stoppedAt ?? marks[marks.length - 1] ?? 0;
    session.note =
      `${STOPPED} at ${formatSeconds(at)} · ${String(marks.length)}/${String(cfg.stages.length)} stages` +
      (splits ? ` · ${splits}` : "");
  }
  return session;
}

/** Total time of a session if it is a completed for-time run of `stageCount` stages. */
export function finishedTime(session: Session, stageCount: number): number | undefined {
  if (!session.finishedAt || !session.note?.startsWith(FINISHED)) return undefined;
  const sets = session.entries.flatMap((e) => e.sets);
  if (sets.length !== stageCount) return undefined;
  let total = 0;
  for (const s of sets) {
    if (s.seconds == null || s.seconds <= 0) return undefined;
    total += s.seconds;
  }
  return total;
}

/**
 * Fastest completed run of a template, ignoring the run that started at
 * `excludeStartedAt` (the one just logged, so "previous best" means
 * previous). Stopped-early runs never count — a fast partial Murph is not
 * a Murph.
 */
export function bestForTime(
  sessions: Session[],
  templateId: string,
  stageCount: number,
  excludeStartedAt?: string,
): number | undefined {
  let best: number | undefined;
  for (const s of sessions) {
    if (s.templateId !== templateId || s.date === excludeStartedAt) continue;
    const t = finishedTime(s, stageCount);
    if (t != null && (best == null || t < best)) best = t;
  }
  return best;
}
