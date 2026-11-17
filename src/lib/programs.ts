/**
 * Programs Mímir (the in-app trainer, mimir.ts) wrote with the owner, kept
 * in the training database beside the sessions (AppData.programs, the Rust
 * store's `programs` table).
 *
 * They are ordinary `Template`s and run in the same players. Mímir may only
 * use built-in exercises (each has its own animation and cues) and every
 * program passes `templateProblems` — the same rules check:content holds the
 * built-ins to — before it can be saved, and again before it starts.
 *
 * React code reads them from AppData. Code outside React that looks a
 * template up by id (music, voice lines) reads the copy the AppProvider
 * keeps here, set before the first render and after every change.
 */
import type { AppData, SavedProgram, Template } from "../types";
import { seedTemplates } from "./seed";

/** Every Mímir program id starts with this; built-ins never do (check:content). */
export const PROGRAM_PREFIX = "mimir-";

let loaded: readonly SavedProgram[] = [];

export function setLoadedPrograms(programs: readonly SavedProgram[]): void {
  loaded = programs;
}

export function isProgram(id: string): boolean {
  return id.startsWith(PROGRAM_PREFIX);
}

/** The built-ins, then the given programs. A fresh array the caller may sort. */
export function templatesWith(programs: readonly SavedProgram[]): Template[] {
  return [...seedTemplates(), ...programs.map((p) => p.template)];
}

/** Every template, built-in or saved. Outside React; in React use `templatesWith(data.programs)`. */
export function allTemplates(): Template[] {
  return templatesWith(loaded);
}

export function templateById(id: string | undefined): Template | undefined {
  if (id === undefined) return undefined;
  return seedTemplates().find((t) => t.id === id) ?? loaded.find((p) => p.id === id)?.template;
}

/** Save a new program, or replace the one with the same id. */
export function withProgram(data: AppData, template: Template, savedAt: string): AppData {
  if (!isProgram(template.id)) throw new Error(`Program ids start with "${PROGRAM_PREFIX}"`);
  const rest = data.programs.filter((p) => p.id !== template.id);
  return { ...data, programs: [...rest, { id: template.id, template, savedAt }] };
}

export function withoutProgram(data: AppData, id: string): AppData {
  return { ...data, programs: data.programs.filter((p) => p.id !== id) };
}
