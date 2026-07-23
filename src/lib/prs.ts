import type {
  Exercise,
  PersonalRecord,
  PRKind,
  Session,
} from "../types";
import { estimate1RM } from "./units";

/**
 * All PR kinds in Varg are "higher is better":
 *   1rm/weight/reps/time(hold)/distance.
 * Runs/rucks track longest distance; holds track longest duration.
 */
export function prKindsFor(ex: Exercise): PRKind[] {
  switch (ex.metric) {
    case "weight_reps":
      return ["1rm", "weight"];
    case "reps":
      return ["reps"];
    case "time":
      return ["time"];
    case "distance_time":
      return ["distance"];
  }
}

export function prKindLabel(kind: PRKind): string {
  switch (kind) {
    case "1rm":
      return "Est. 1RM";
    case "weight":
      return "Top weight";
    case "reps":
      return "Max reps";
    case "time":
      return "Best hold";
    case "distance":
      return "Longest";
  }
}

interface Candidate {
  kind: PRKind;
  value: number;
  reps?: number;
}

/** Best candidate PRs for a single exercise across a session's sets. */
function candidatesForEntry(
  ex: Exercise,
  sets: { weight?: number; reps?: number; seconds?: number; meters?: number; done: boolean }[],
): Candidate[] {
  const done = sets.filter((s) => s.done);
  const out: Candidate[] = [];
  if (ex.metric === "weight_reps") {
    let best1rm = 0;
    let best1rmReps = 0;
    let bestWeight = 0;
    let bestWeightReps = 0;
    for (const s of done) {
      if (s.weight == null || s.reps == null || s.reps <= 0) continue;
      const oneRm = estimate1RM(s.weight, s.reps);
      if (oneRm > best1rm) {
        best1rm = oneRm;
        best1rmReps = s.reps;
      }
      if (s.weight > bestWeight) {
        bestWeight = s.weight;
        bestWeightReps = s.reps;
      }
    }
    if (best1rm > 0) out.push({ kind: "1rm", value: best1rm, reps: best1rmReps });
    if (bestWeight > 0) out.push({ kind: "weight", value: bestWeight, reps: bestWeightReps });
  } else if (ex.metric === "reps") {
    const best = Math.max(0, ...done.map((s) => s.reps ?? 0));
    if (best > 0) out.push({ kind: "reps", value: best });
  } else if (ex.metric === "time") {
    const best = Math.max(0, ...done.map((s) => s.seconds ?? 0));
    if (best > 0) out.push({ kind: "time", value: best });
  } else if (ex.metric === "distance_time") {
    const best = Math.max(0, ...done.map((s) => s.meters ?? 0));
    if (best > 0) out.push({ kind: "distance", value: best });
  }
  return out;
}

/**
 * Recompute auto-detected PRs from all sessions, preserving manual PRs.
 * Keeps the single best value per (exercise, kind).
 */
export function recomputePRs(
  sessions: Session[],
  exercises: Exercise[],
  existing: PersonalRecord[],
): PersonalRecord[] {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const manual = existing.filter((p) => p.manual);

  // Best auto PR per exercise+kind.
  const best = new Map<string, PersonalRecord>();

  const ordered = [...sessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  for (const session of ordered) {
    for (const entry of session.entries) {
      const ex = exById.get(entry.exerciseId);
      if (!ex) continue;
      const cands = candidatesForEntry(ex, entry.sets);
      const when = session.finishedAt ?? session.date;
      for (const c of cands) {
        const key = `${ex.id}:${c.kind}`;
        const prev = best.get(key);
        if (!prev || c.value > prev.value) {
          best.set(key, {
            id: `auto-${key}`,
            exerciseId: ex.id,
            kind: c.kind,
            value: c.value,
            reps: c.reps,
            date: when,
            sessionId: session.id,
            manual: false,
          });
        }
      }
    }
  }

  return [...manual, ...best.values()];
}
