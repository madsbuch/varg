/**
 * localStorage fallback backend — used when the app runs as a plain web
 * page (e.g. `bun run dev` in a browser) where the Rust store is
 * unavailable. Mirrors the SQLite backend's interface over the legacy
 * JSON blob.
 */
import type {
  AppData,
  ChatEntry,
  ChatItem,
  ChatMessage,
  Exercise,
  PersonalRecord,
  SavedProgram,
  Session,
} from "../types";
import { loadData, saveData } from "../lib/store";
import type { Loaded, Persistence } from "./persistence";

export class LocalStoragePersistence implements Persistence {
  private cache: AppData = loadData().data;

  private flush(): void {
    saveData(this.cache);
  }

  load(): Promise<Loaded> {
    const loaded = loadData();
    this.cache = loaded.data;
    return Promise.resolve(loaded);
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

  saveProgram(p: SavedProgram): Promise<void> {
    this.cache = { ...this.cache, programs: this.upsert(this.cache.programs, p) };
    this.flush();
    return Promise.resolve();
  }

  deleteProgram(id: string): Promise<void> {
    this.cache = { ...this.cache, programs: this.cache.programs.filter((p) => p.id !== id) };
    this.flush();
    return Promise.resolve();
  }

  saveChatItem(row: ChatEntry<ChatItem>): Promise<void> {
    this.cache = { ...this.cache, mimir: { ...this.cache.mimir, items: this.upsert(this.cache.mimir.items, row) } };
    this.flush();
    return Promise.resolve();
  }

  deleteChatItem(id: string): Promise<void> {
    this.cache = { ...this.cache, mimir: { ...this.cache.mimir, items: this.cache.mimir.items.filter((r) => r.id !== id) } };
    this.flush();
    return Promise.resolve();
  }

  saveChatMessage(row: ChatEntry<ChatMessage>): Promise<void> {
    this.cache = { ...this.cache, mimir: { ...this.cache.mimir, messages: this.upsert(this.cache.mimir.messages, row) } };
    this.flush();
    return Promise.resolve();
  }

  deleteChatMessage(id: string): Promise<void> {
    this.cache = { ...this.cache, mimir: { ...this.cache.mimir, messages: this.cache.mimir.messages.filter((r) => r.id !== id) } };
    this.flush();
    return Promise.resolve();
  }
}
