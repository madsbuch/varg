/**
 * Programs Mímir (the in-app trainer, mimir.ts) wrote with the owner, kept
 * on this device beside the built-ins from seed.ts.
 *
 * They are ordinary `Template`s and run in the same players. Mímir may only
 * use built-in exercises (each has its own animation and cues) and every
 * program passes `templateProblems` — the same rules db:smoke holds the
 * built-ins to — before it can be saved, and again before it starts.
 *
 * Stored in localStorage like the other device settings, never in the
 * training database: a program is content, and a session that ran one
 * keeps its own copy of what was done.
 */
import { useSyncExternalStore } from "react";
import type { Template } from "../types";
import { seedTemplates } from "./seed";

/** Every Mímir program id starts with this; built-ins never do (db:smoke). */
export const PROGRAM_PREFIX = "mimir-";

const KEY = "varg.programs.v1";

export interface SavedProgram {
  template: Template;
  /** ISO, when the owner saved it. */
  savedAt: string;
}

function read(): SavedProgram[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedProgram[]).filter((p) => p.template.id.startsWith(PROGRAM_PREFIX)) : [];
  } catch {
    return [];
  }
}

let programs: SavedProgram[] = typeof localStorage === "undefined" ? [] : read();
let all: Template[] | null = null;
const listeners = new Set<() => void>();

function write(next: SavedProgram[]): void {
  // Storage must hold it: a program that seems saved and is gone on the
  // next launch is the silent failure to avoid, so this throws.
  localStorage.setItem(KEY, JSON.stringify(next));
  programs = next;
  all = null;
  for (const l of listeners) l();
}

export function loadPrograms(): SavedProgram[] {
  return programs;
}

/** Save a new program, or replace the one with the same id. */
export function saveProgram(template: Template): void {
  if (!template.id.startsWith(PROGRAM_PREFIX)) throw new Error(`Program ids start with "${PROGRAM_PREFIX}"`);
  const rest = programs.filter((p) => p.template.id !== template.id);
  write([...rest, { template, savedAt: new Date().toISOString() }]);
}

export function deleteProgram(id: string): void {
  write(programs.filter((p) => p.template.id !== id));
}

export function isProgram(id: string): boolean {
  return id.startsWith(PROGRAM_PREFIX);
}

/** The built-ins, then the owner's programs. A fresh array the caller may sort. */
export function allTemplates(): Template[] {
  all ??= [...seedTemplates(), ...programs.map((p) => p.template)];
  return [...all];
}

export function templateById(id: string | undefined): Template | undefined {
  if (!id) return undefined;
  return seedTemplates().find((t) => t.id === id) ?? programs.find((p) => p.template.id === id)?.template;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Re-renders when a program is saved or deleted. */
export function usePrograms(): SavedProgram[] {
  return useSyncExternalStore(subscribe, () => programs);
}
