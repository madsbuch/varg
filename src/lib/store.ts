import type {
  AppData,
  Exercise,
  PersonalRecord,
  Session,
  SessionEntry,
  WorkoutSet,
} from "../types";
import { EX, seedExercises } from "./seed";
import { recomputePRs } from "./prs";
import { z } from "zod";
import { parseJsonAs } from "./schema";
import { readDataBlob } from "../db/read";
import type { Loaded } from "../db/persistence";

export const STORAGE_KEY = "varg.data.v1";
const DATA_VERSION = 1;

export function uid(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${rand}`;
}

function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    exercises: seedExercises(),
    sessions: [],
    prs: [],
    programs: [],
    mimir: { items: [], messages: [] },
  };
}

/**
 * A new database's first contents: the built-ins, plus everything in a
 * legacy JSON blob when the phone has one. A blob that does not read
 * throws with every problem in it, rather than start the owner empty.
 */
export function freshData(legacy: string | null): AppData {
  if (legacy === null) return emptyData();
  const parsed = parseJsonAs(z.unknown(), legacy, STORAGE_KEY);
  if (!parsed.ok) throw new Error(`Old training data unreadable: ${parsed.problems.join("; ")}`);
  const { data, problems } = readDataBlob(parsed.value);
  if (problems.length > 0) throw new Error(`Old training data unreadable: ${problems.join("; ")}`);
  return mergeBuiltIns({ ...data, exercises: data.exercises.length > 0 ? data.exercises : seedExercises() });
}

/**
 * Merge freshly-seeded built-ins into stored data so that new built-in
 * exercises shipped in an update appear without wiping user data.
 */
export function mergeBuiltIns(data: AppData): AppData {
  const exIds = new Set(data.exercises.map((e) => e.id));
  for (const ex of seedExercises()) {
    if (!exIds.has(ex.id)) data.exercises.push(ex);
  }

  // Retire superseded built-ins. A semantic correction to an existing
  // exercise ships as a NEW id (mergeBuiltIns can only add, never rewrite),
  // which leaves an upgraded device holding both — two rows with the same
  // name, subtitle and animation, one of them the version with the bug.
  // The old row has to stay so existing history and PRs keep resolving, so
  // it is renamed instead of deleted, and it is never offered as a choice.
  for (const ex of data.exercises) {
    const successor = SUPERSEDED[ex.id];
    if (!successor) continue;
    ex.deprecated = true;
    if (!ex.name.endsWith(DEPRECATED_SUFFIX)) {
      ex.name = `${ex.name}${DEPRECATED_SUFFIX}`;
    }
  }
  return data;
}

const DEPRECATED_SUFFIX = " (old)";

/**
 * Built-in ids replaced by a corrected version, mapped to their successor.
 * Only ever grows — an entry here is a promise to a device in the field.
 */
const SUPERSEDED: Record<string, string> = {
  [EX.farmerCarry]: EX.farmerCarryDistance,
};

/**
 * The browser backend's data (vite dev): the JSON blob in localStorage.
 * Unreadable rows come back as problems, shown in red.
 */
export function loadData(): Loaded {
  if (typeof localStorage === "undefined") return { data: emptyData(), problems: [] };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return { data: emptyData(), problems: [] };
  const parsed = parseJsonAs(z.unknown(), raw, STORAGE_KEY);
  if (!parsed.ok) return { data: emptyData(), problems: parsed.problems };
  const loaded = readDataBlob(parsed.value);
  return { data: mergeBuiltIns(loaded.data), problems: loaded.problems };
}

export function saveData(data: AppData): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// --- Pure update helpers operating on AppData (immutably) ---

export function upsertExercise(data: AppData, ex: Exercise): AppData {
  const exists = data.exercises.some((e) => e.id === ex.id);
  const exercises = exists
    ? data.exercises.map((e) => (e.id === ex.id ? ex : e))
    : [...data.exercises, ex];
  return { ...data, exercises };
}

export function deleteExercise(data: AppData, id: string): AppData {
  return { ...data, exercises: data.exercises.filter((e) => e.id !== id) };
}

export function upsertSession(data: AppData, session: Session): AppData {
  const exists = data.sessions.some((s) => s.id === session.id);
  const sessions = exists
    ? data.sessions.map((s) => (s.id === session.id ? session : s))
    : [session, ...data.sessions];
  const next = { ...data, sessions };
  next.prs = recomputePRs(next.sessions, next.exercises, next.prs);
  return next;
}

export function deleteSession(data: AppData, id: string): AppData {
  const sessions = data.sessions.filter((s) => s.id !== id);
  const prs = recomputePRs(sessions, data.exercises, data.prs);
  return { ...data, sessions, prs };
}

/**
 * Manual PRs are keyed by (exercise, kind): logging one replaces the previous
 * manual entry instead of stacking a second, contradictory number beside it.
 * Auto rows are left alone — they are derived from sessions and recomputePRs
 * owns them.
 */
export function addManualPR(data: AppData, pr: PersonalRecord): AppData {
  const kept = data.prs.filter(
    (p) => !(p.manual && p.exerciseId === pr.exerciseId && p.kind === pr.kind),
  );
  return { ...data, prs: [...kept, pr] };
}

export function deletePR(data: AppData, id: string): AppData {
  return { ...data, prs: data.prs.filter((p) => p.id !== id) };
}

// --- Session construction helpers ---

export function emptySet(): WorkoutSet {
  return { id: uid("set"), done: false };
}

export function newEntry(exerciseId: string, sets = 3): SessionEntry {
  return {
    id: uid("entry"),
    exerciseId,
    sets: Array.from({ length: sets }, () => emptySet()),
  };
}

export function newSession(name: string): Session {
  return {
    id: uid("session"),
    name,
    date: new Date().toISOString(),
    entries: [],
  };
}
