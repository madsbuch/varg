import type {
  AppData,
  Exercise,
  PersonalRecord,
  Session,
  SessionEntry,
  Split,
  WorkoutSet,
} from "../types";
import { seedExercises, seedSplits } from "./seed";
import { recomputePRs } from "./prs";

export const STORAGE_KEY = "varg.data.v1";
const DATA_VERSION = 1;

export function uid(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${rand}`;
}

function freshData(): AppData {
  return {
    version: DATA_VERSION,
    exercises: seedExercises(),
    splits: seedSplits(),
    sessions: [],
    prs: [],
  };
}

/**
 * Merge freshly-seeded built-ins into stored data so that new built-in
 * exercises/splits shipped in an update appear without wiping user data.
 */
export function mergeBuiltIns(data: AppData): AppData {
  const exIds = new Set(data.exercises.map((e) => e.id));
  for (const ex of seedExercises()) {
    if (!exIds.has(ex.id)) data.exercises.push(ex);
  }
  const splitIds = new Set(data.splits.map((s) => s.id));
  for (const sp of seedSplits()) {
    if (!splitIds.has(sp.id)) data.splits.push(sp);
  }
  return data;
}

export function loadData(): AppData {
  if (typeof localStorage === "undefined") return freshData();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return freshData();
  try {
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const data: AppData = {
      version: DATA_VERSION,
      exercises: parsed.exercises ?? seedExercises(),
      splits: parsed.splits ?? seedSplits(),
      sessions: parsed.sessions ?? [],
      prs: parsed.prs ?? [],
    };
    return mergeBuiltIns(data);
  } catch {
    return freshData();
  }
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

export function upsertSplit(data: AppData, split: Split): AppData {
  const exists = data.splits.some((s) => s.id === split.id);
  const splits = exists
    ? data.splits.map((s) => (s.id === split.id ? split : s))
    : [...data.splits, split];
  return { ...data, splits };
}

export function deleteSplit(data: AppData, id: string): AppData {
  return { ...data, splits: data.splits.filter((s) => s.id !== id) };
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
