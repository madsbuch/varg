import type {
  Exercise,
  PersonalRecord,
  PRKind,
  Session,
  WorkoutSet,
} from "../types";
import { PR_DIRECTION } from "../types";
import { estimate1RM } from "./units";

/**
 * Which records an exercise can hold, given how it is measured.
 *
 * The switch is exhaustive on purpose: a new metric has to state its kinds
 * here, and every kind has to declare a direction in `PR_DIRECTION`. That
 * chain is what stops a for-time exercise from silently recording the worst
 * attempt — see the note on PR_DIRECTION in types.ts.
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

/** Does `value` beat `than` for this kind? The only PR comparison there is. */
export function isBetterPR(kind: PRKind, value: number, than: number): boolean {
  return PR_DIRECTION[kind] === "lower" ? value < than : value > than;
}

/** The standing record for an (exercise, kind), across auto and manual rows. */
export function bestPRFor(
  prs: PersonalRecord[],
  exerciseId: string,
  kind: PRKind,
): PersonalRecord | undefined {
  let best: PersonalRecord | undefined;
  for (const pr of prs) {
    if (pr.exerciseId !== exerciseId || pr.kind !== kind) continue;
    if (!best || isBetterPR(kind, pr.value, best.value)) best = pr;
  }
  return best;
}

interface Candidate {
  kind: PRKind;
  value: number;
  reps?: number;
}

/**
 * Best of a set of measurements for one kind. Zero and undefined mean "not
 * logged", never a record — on a lower-is-better kind an unlogged set would
 * otherwise win outright.
 */
function bestOf(kind: PRKind, values: (number | undefined)[]): number | undefined {
  let best: number | undefined;
  for (const v of values) {
    if (v == null || v <= 0) continue;
    if (best == null || isBetterPR(kind, v, best)) best = v;
  }
  return best;
}

/** Best candidate PRs for a single exercise across a session's sets. */
function candidatesForEntry(ex: Exercise, sets: WorkoutSet[]): Candidate[] {
  const done = sets.filter((s) => s.done);
  const out: Candidate[] = [];
  if (ex.metric === "weight_reps") {
    // Both kinds carry the rep count of the set they came from as context,
    // so they are tracked together rather than through bestOf.
    let oneRm: Candidate | undefined;
    let top: Candidate | undefined;
    for (const s of done) {
      if (s.weight == null || s.reps == null || s.reps <= 0) continue;
      const est = estimate1RM(s.weight, s.reps);
      if (est > 0 && (!oneRm || isBetterPR("1rm", est, oneRm.value))) {
        oneRm = { kind: "1rm", value: est, reps: s.reps };
      }
      if (s.weight > 0 && (!top || isBetterPR("weight", s.weight, top.value))) {
        top = { kind: "weight", value: s.weight, reps: s.reps };
      }
    }
    if (oneRm) out.push(oneRm);
    if (top) out.push(top);
  } else if (ex.metric === "reps") {
    const best = bestOf("reps", done.map((s) => s.reps));
    if (best != null) out.push({ kind: "reps", value: best });
  } else if (ex.metric === "time") {
    const best = bestOf("time", done.map((s) => s.seconds));
    if (best != null) out.push({ kind: "time", value: best });
  } else {
    const best = bestOf("distance", done.map((s) => s.meters));
    if (best != null) out.push({ kind: "distance", value: best });
  }
  return out;
}

/** Positional equality on the fields we persist, so an unchanged recompute
 *  can return the previous array and skip rewriting the whole PR table. */
function sameRecords(a: PersonalRecord[], b: PersonalRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (
      x.id !== y.id ||
      x.exerciseId !== y.exerciseId ||
      x.kind !== y.kind ||
      x.value !== y.value ||
      x.reps !== y.reps ||
      x.date !== y.date ||
      x.sessionId !== y.sessionId ||
      x.manual !== y.manual
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Recompute auto-detected PRs from all sessions, preserving manual PRs.
 * Keeps the single best value per (exercise, kind).
 *
 * Manual rows survive untouched — they are the athlete's own data, and a
 * manual value *below* the auto one is often a deliberate correction of an
 * inflated Epley estimate, so it is never dropped here. Collapsing an
 * exercise to the one record that stands is `collapsePRs`' job, on the way
 * to the screen.
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
        if (!prev || isBetterPR(c.kind, c.value, prev.value)) {
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

  // Deterministic order, standing record first within each (exercise, kind).
  // The old output put manual rows first after a session save and last after
  // addManualPR, so consumers taking the first match flipped answers on an
  // unrelated action.
  const all = [...best.values(), ...manual].sort((a, b) => {
    if (a.exerciseId !== b.exerciseId)
      return a.exerciseId.localeCompare(b.exerciseId);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.value !== b.value) return isBetterPR(a.kind, a.value, b.value) ? -1 : 1;
    return Number(a.manual) - Number(b.manual);
  });

  // Every set edit runs this; handing back the same reference when nothing
  // moved keeps the persistence diff from dropping and rebuilding the table.
  return sameRecords(existing, all) ? existing : all;
}

/** One (exercise, kind) as it should be shown: the record that stands, plus
 *  the manual entries it beat. */
export interface PRRow {
  exerciseId: string;
  kind: PRKind;
  best: PersonalRecord;
  /**
   * Manual entries the winner beat. Rendered, not discarded: a lower manual
   * value is sometimes a deliberate correction of an inflated Epley estimate,
   * and the athlete can only act on it — delete it, or accept it — if it is
   * on screen.
   */
  superseded: PersonalRecord[];
}

/**
 * Collapse a PR list to one winning row per (exercise, kind). Every surface
 * that lists PRs goes through this; rendering one row per stored record shows
 * the same exercise twice with contradictory numbers.
 */
export function collapsePRs(prs: PersonalRecord[]): PRRow[] {
  const rows = new Map<string, PRRow>();
  for (const pr of prs) {
    const key = `${pr.exerciseId}:${pr.kind}`;
    const row = rows.get(key);
    if (!row) {
      rows.set(key, {
        exerciseId: pr.exerciseId,
        kind: pr.kind,
        best: pr,
        superseded: [],
      });
      continue;
    }
    // On a tie the auto row wins: it carries the session it came from.
    const wins =
      isBetterPR(pr.kind, pr.value, row.best.value) ||
      (pr.value === row.best.value && row.best.manual && !pr.manual);
    const loser = wins ? row.best : pr;
    if (wins) row.best = pr;
    if (loser.manual) row.superseded.push(loser);
  }
  return [...rows.values()];
}
