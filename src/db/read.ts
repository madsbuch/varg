/**
 * Reading stored training data with the schemas in lib/schema.ts: the Rust
 * store's snapshot, and the JSON blob the browser backend (and pre-SQLite
 * phones) keep. Row by row, so one unreadable row is a named problem and
 * the rest of the owner's history still loads.
 */
import { z } from "zod";
import type { AppData } from "../types";
import {
  ChatItemEntrySchema,
  ChatMessageEntrySchema,
  ExerciseSchema,
  parseAs,
  PersonalRecordSchema,
  SavedProgramSchema,
  SessionSchema,
  SnapshotSchema,
} from "../lib/schema";
import type { Loaded } from "./persistence";

/** Every row that reads, in order; every one that does not goes into `problems`. */
export function each<S extends z.ZodType>(rows: readonly unknown[], schema: S, path: string, problems: string[]): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  rows.forEach((row, i) => {
    const r = parseAs(schema, row, `${path}[${i}]`);
    if (r.ok) out.push(r.value);
    else problems.push(...r.problems);
  });
  return out;
}

const emptyData = (): AppData => ({ version: 1, exercises: [], sessions: [], prs: [], programs: [], mimir: { items: [], messages: [] } });

/** What `store_load` sends: the snapshot, every row read on its own. */
export function readSnapshot(raw: unknown): Loaded {
  const snap = parseAs(SnapshotSchema, raw, "snapshot");
  if (!snap.ok) return { data: emptyData(), problems: snap.problems };
  const s = snap.value;
  const problems = [...s.problems];
  const data: AppData = {
    version: 1,
    exercises: each(s.exercises, ExerciseSchema, "exercises", problems),
    sessions: each(s.sessions, SessionSchema, "sessions", problems),
    prs: each(s.prs, PersonalRecordSchema, "prs", problems),
    programs: each(s.programs, SavedProgramSchema, "programs", problems),
    mimir: {
      items: each(s.mimirItems, ChatItemEntrySchema, "mimirItems", problems),
      messages: each(s.mimirMessages, ChatMessageEntrySchema, "mimirMessages", problems),
    },
  };
  return { data, problems };
}

/**
 * The JSON blob (AppData as JSON.stringify writes it). Programs and the chat
 * are optional: blobs written before Mímir have neither.
 */
const DataBlobSchema = z.object({
  exercises: z.array(z.unknown()),
  sessions: z.array(z.unknown()),
  prs: z.array(z.unknown()),
  programs: z.array(z.unknown()).optional(),
  mimir: z.object({ items: z.array(z.unknown()), messages: z.array(z.unknown()) }).optional(),
});

export function readDataBlob(raw: unknown): Loaded {
  const blob = parseAs(DataBlobSchema, raw, "data");
  if (!blob.ok) return { data: emptyData(), problems: blob.problems };
  const b = blob.value;
  const problems: string[] = [];
  const data: AppData = {
    version: 1,
    exercises: each(b.exercises, ExerciseSchema, "exercises", problems),
    sessions: each(b.sessions, SessionSchema, "sessions", problems),
    prs: each(b.prs, PersonalRecordSchema, "prs", problems),
    programs: each(b.programs ?? [], SavedProgramSchema, "programs", problems),
    mimir: {
      items: each(b.mimir?.items ?? [], ChatItemEntrySchema, "mimir.items", problems),
      messages: each(b.mimir?.messages ?? [], ChatMessageEntrySchema, "mimir.messages", problems),
    },
  };
  return { data, problems };
}
