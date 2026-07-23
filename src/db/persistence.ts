/**
 * Persistence abstraction. The app keeps working state in memory
 * (AppData in React context) and writes through to a backend:
 *
 *  - SQLite via tauri-plugin-sql + Drizzle when running inside Tauri
 *  - localStorage when running as a plain web page (vite dev in a browser)
 *
 * Writes are derived by diffing successive AppData snapshots. Store
 * helpers update immutably, so reference equality identifies changes.
 */
import type {
  AppData,
  Exercise,
  PersonalRecord,
  Session,
  Split,
} from "../types";

export interface Persistence {
  load(): Promise<AppData>;
  saveExercise(ex: Exercise): Promise<void>;
  deleteExercise(id: string): Promise<void>;
  saveSplit(split: Split): Promise<void>;
  deleteSplit(id: string): Promise<void>;
  saveSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  replacePRs(prs: PersonalRecord[]): Promise<void>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createPersistence(): Promise<Persistence> {
  if (isTauri()) {
    const { SqlitePersistence } = await import("./sqlite");
    return SqlitePersistence.open();
  }
  const { LocalStoragePersistence } = await import("./local");
  return new LocalStoragePersistence();
}

interface HasId {
  id: string;
}

async function diffById<T extends HasId>(
  prev: T[],
  next: T[],
  save: (item: T) => Promise<void>,
  remove: (id: string) => Promise<void>,
): Promise<void> {
  if (prev === next) return;
  const prevById = new Map(prev.map((x) => [x.id, x]));
  const nextIds = new Set(next.map((x) => x.id));
  for (const p of prev) {
    if (!nextIds.has(p.id)) await remove(p.id);
  }
  for (const n of next) {
    if (prevById.get(n.id) !== n) await save(n);
  }
}

/** Write everything that changed between two snapshots. */
export async function persistDiff(
  p: Persistence,
  prev: AppData,
  next: AppData,
): Promise<void> {
  if (prev === next) return;
  await diffById(prev.exercises, next.exercises, (e) => p.saveExercise(e), (id) => p.deleteExercise(id));
  await diffById(prev.splits, next.splits, (s) => p.saveSplit(s), (id) => p.deleteSplit(id));
  await diffById(prev.sessions, next.sessions, (s) => p.saveSession(s), (id) => p.deleteSession(id));
  if (prev.prs !== next.prs) await p.replacePRs(next.prs);
}
