/**
 * The training database in the app: the Rust store (src-tauri/store, SQLite
 * through Diesel), reached over Tauri commands (src-tauri/src/storage.rs).
 *
 * Both directions are strict. Writes send exactly the fields the Rust types
 * declare (Rust refuses any other); the snapshot that comes back is decoded
 * field by field, and anything the store could not read arrives as a
 * problem the app shows in red, never as a quietly missing row.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ChatEntry, ChatItem, ChatMessage, Exercise, PersonalRecord, SavedProgram, Session } from "../types";
import { readSnapshot } from "./read";
import { freshData, mergeBuiltIns, STORAGE_KEY } from "../lib/store";
import { kvGet } from "../lib/kv";
import type { Loaded, Persistence } from "./persistence";

/* ------------------------------- Writing --------------------------------- */
// Exactly the fields the Rust types declare: the app's objects carry more
// (an exercise's `deprecated` flag is derived, not stored).

export function exerciseWire(e: Exercise) {
  return { id: e.id, name: e.name, category: e.category, metric: e.metric, muscles: e.muscles, builtIn: e.builtIn };
}

export function sessionWire(s: Session) {
  return {
    id: s.id,
    name: s.name,
    date: s.date,
    finishedAt: s.finishedAt,
    templateId: s.templateId,
    note: s.note,
    heartRate: s.heartRate ? { avg: s.heartRate.avg, max: s.heartRate.max, every: s.heartRate.every, trace: s.heartRate.trace } : undefined,
    entries: s.entries.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      note: e.note,
      sets: e.sets.map((w) => ({ id: w.id, weight: w.weight, reps: w.reps, seconds: w.seconds, meters: w.meters, rpe: w.rpe, done: w.done })),
    })),
  };
}

export function prWire(p: PersonalRecord) {
  return {
    id: p.id,
    exerciseId: p.exerciseId,
    kind: p.kind,
    value: p.value,
    reps: p.reps,
    date: p.date,
    sessionId: p.sessionId,
    note: p.note,
    manual: p.manual,
  };
}

export function programWire(p: SavedProgram) {
  return { id: p.id, template: p.template, savedAt: p.savedAt };
}

export function chatWire<T>(row: ChatEntry<T>) {
  return { id: row.id, seq: row.seq, body: row.body };
}

export class RustPersistence implements Persistence {
  static async open(): Promise<RustPersistence> {
    await invoke("store_open");
    return new RustPersistence();
  }

  async load(): Promise<Loaded> {
    const raw: unknown = await invoke("store_load");
    const loaded = readSnapshot(raw);
    if (loaded.data.exercises.length === 0 && loaded.problems.length === 0) {
      // A fresh database: seed it, importing the pre-SQLite JSON blob if
      // this phone still has one (it moved into the settings store).
      const legacy = kvGet(STORAGE_KEY);
      const initial = freshData(legacy);
      for (const ex of initial.exercises) await this.saveExercise(ex);
      for (const s of initial.sessions) await this.saveSession(s);
      await this.replacePRs(initial.prs);
      return { data: initial, problems: [] };
    }
    // Built-ins shipped in an update are not in this phone's database yet.
    const known = new Set(loaded.data.exercises.map((e) => e.id));
    mergeBuiltIns(loaded.data);
    for (const ex of loaded.data.exercises) {
      if (!known.has(ex.id)) await this.saveExercise(ex);
    }
    return loaded;
  }

  async saveExercise(ex: Exercise): Promise<void> {
    await invoke("store_save_exercise", { exercise: exerciseWire(ex) });
  }

  async deleteExercise(id: string): Promise<void> {
    await invoke("store_delete_exercise", { id });
  }

  async saveSession(session: Session): Promise<void> {
    await invoke("store_save_session", { session: sessionWire(session) });
  }

  async deleteSession(id: string): Promise<void> {
    await invoke("store_delete_session", { id });
  }

  async replacePRs(prs: PersonalRecord[]): Promise<void> {
    await invoke("store_replace_prs", { prs: prs.map(prWire) });
  }

  async saveProgram(p: SavedProgram): Promise<void> {
    await invoke("store_save_program", { program: programWire(p) });
  }

  async deleteProgram(id: string): Promise<void> {
    await invoke("store_delete_program", { id });
  }

  async saveChatItem(row: ChatEntry<ChatItem>): Promise<void> {
    await invoke("store_save_chat_item", { row: chatWire(row) });
  }

  async deleteChatItem(id: string): Promise<void> {
    await invoke("store_delete_chat_item", { id });
  }

  async saveChatMessage(row: ChatEntry<ChatMessage>): Promise<void> {
    await invoke("store_save_chat_message", { row: chatWire(row) });
  }

  async deleteChatMessage(id: string): Promise<void> {
    await invoke("store_delete_chat_message", { id });
  }
}
