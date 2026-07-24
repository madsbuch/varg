/**
 * localStorage fallback backend — used when the app runs as a plain web
 * page (e.g. `bun run dev` in a browser) where tauri-plugin-sql is
 * unavailable. Mirrors the SQLite backend's interface over the legacy
 * JSON blob.
 */
import type {
  AppData,
  Exercise,
  PersonalRecord,
  Session,
  Split,
} from "../types";
import { loadData, saveData } from "../lib/store";
import type { Persistence } from "./persistence";

export class LocalStoragePersistence implements Persistence {
  private cache: AppData = loadData();

  private flush(): void {
    saveData(this.cache);
  }

  load(): Promise<AppData> {
    this.cache = loadData();
    return Promise.resolve(this.cache);
  }

  private upsert<T extends { id: string }>(list: T[], item: T): T[] {
    const i = list.findIndex((x) => x.id === item.id);
    if (i === -1) return [...list, item];
    const next = [...list];
    next[i] = item;
    return next;
  }

  saveExercise(ex: Exercise): Promise<void> {
    this.cache = { ...this.cache, exercises: this.upsert(this.cache.exercises, ex) };
    this.flush();
    return Promise.resolve();
  }

  deleteExercise(id: string): Promise<void> {
    this.cache = { ...this.cache, exercises: this.cache.exercises.filter((e) => e.id !== id) };
    this.flush();
    return Promise.resolve();
  }

  saveSplit(split: Split): Promise<void> {
    this.cache = { ...this.cache, splits: this.upsert(this.cache.splits, split) };
    this.flush();
    return Promise.resolve();
  }

  deleteSplit(id: string): Promise<void> {
    this.cache = { ...this.cache, splits: this.cache.splits.filter((s) => s.id !== id) };
    this.flush();
    return Promise.resolve();
  }

  saveSession(session: Session): Promise<void> {
    this.cache = { ...this.cache, sessions: this.upsert(this.cache.sessions, session) };
    this.flush();
    return Promise.resolve();
  }

  deleteSession(id: string): Promise<void> {
    this.cache = { ...this.cache, sessions: this.cache.sessions.filter((s) => s.id !== id) };
    this.flush();
    return Promise.resolve();
  }

  replacePRs(prs: PersonalRecord[]): Promise<void> {
    this.cache = { ...this.cache, prs };
    this.flush();
    return Promise.resolve();
  }
}
