/**
 * Strict readers for stored training data: the Rust store's snapshot, and
 * the JSON blob the browser backend (and pre-SQLite phones) keep. Every
 * row on its own Reader, so one unreadable row is a named problem and the
 * rest of the owner's history still loads.
 */
import type {
  AppData,
  Category,
  ChatEntry,
  Exercise,
  HeartRate,
  Metric,
  PersonalRecord,
  PRKind,
  SavedProgram,
  Session,
  SessionEntry,
  WorkoutSet,
} from "../types";
import { Reader, readChatItem, readChatMessage, readTemplate } from "../lib/decode";
import type { Loaded } from "./persistence";

const CATEGORIES: readonly Category[] = ["strength", "bodyweight", "cardio", "ruck", "core", "conditioning"];
const METRICS: readonly Metric[] = ["weight_reps", "reps", "time", "distance_time"];
const PR_KINDS: readonly PRKind[] = ["1rm", "weight", "reps", "time", "distance"];

/* ------------------------------- Reading --------------------------------- */

function readExercise(r: Reader, v: unknown, path: string): Exercise {
  const f = r.obj(v, path);
  return {
    id: r.str(f.get("id"), `${path}.id`),
    name: r.str(f.get("name"), `${path}.name`),
    category: r.oneOf(f.get("category"), CATEGORIES, `${path}.category`),
    metric: r.oneOf(f.get("metric"), METRICS, `${path}.metric`),
    muscles: r.arr(f.get("muscles"), `${path}.muscles`).map((m, i) => r.text(m, `${path}.muscles[${i}]`)),
    builtIn: r.bool(f.get("builtIn"), `${path}.builtIn`),
  };
}

function readSet(r: Reader, v: unknown, path: string): WorkoutSet {
  const f = r.obj(v, path);
  return {
    id: r.str(f.get("id"), `${path}.id`),
    weight: r.optNum(f.get("weight"), `${path}.weight`),
    reps: r.optInt(f.get("reps"), `${path}.reps`),
    seconds: r.optNum(f.get("seconds"), `${path}.seconds`),
    meters: r.optNum(f.get("meters"), `${path}.meters`),
    rpe: r.optNum(f.get("rpe"), `${path}.rpe`),
    done: r.bool(f.get("done"), `${path}.done`),
  };
}

function readEntry(r: Reader, v: unknown, path: string): SessionEntry {
  const f = r.obj(v, path);
  return {
    id: r.str(f.get("id"), `${path}.id`),
    exerciseId: r.str(f.get("exerciseId"), `${path}.exerciseId`),
    sets: r.arr(f.get("sets"), `${path}.sets`).map((x, i) => readSet(r, x, `${path}.sets[${i}]`)),
    note: r.optStr(f.get("note"), `${path}.note`),
  };
}

function readHeartRate(r: Reader, v: unknown, path: string): HeartRate {
  const f = r.obj(v, path);
  return {
    avg: r.num(f.get("avg"), `${path}.avg`),
    max: r.num(f.get("max"), `${path}.max`),
    every: r.num(f.get("every"), `${path}.every`),
    trace: r.arr(f.get("trace"), `${path}.trace`).map((x, i) => r.num(x, `${path}.trace[${i}]`)),
  };
}

function readSession(r: Reader, v: unknown, path: string): Session {
  const f = r.obj(v, path);
  const hr = f.get("heartRate");
  return {
    id: r.str(f.get("id"), `${path}.id`),
    name: r.text(f.get("name"), `${path}.name`),
    date: r.str(f.get("date"), `${path}.date`),
    finishedAt: r.optStr(f.get("finishedAt"), `${path}.finishedAt`),
    templateId: r.optStr(f.get("templateId"), `${path}.templateId`),
    note: r.optStr(f.get("note"), `${path}.note`),
    heartRate: hr === undefined || hr === null ? undefined : readHeartRate(r, hr, `${path}.heartRate`),
    entries: r.arr(f.get("entries"), `${path}.entries`).map((x, i) => readEntry(r, x, `${path}.entries[${i}]`)),
  };
}

function readPR(r: Reader, v: unknown, path: string): PersonalRecord {
  const f = r.obj(v, path);
  return {
    id: r.str(f.get("id"), `${path}.id`),
    exerciseId: r.str(f.get("exerciseId"), `${path}.exerciseId`),
    kind: r.oneOf(f.get("kind"), PR_KINDS, `${path}.kind`),
    value: r.num(f.get("value"), `${path}.value`),
    reps: r.optInt(f.get("reps"), `${path}.reps`),
    date: r.str(f.get("date"), `${path}.date`),
    sessionId: r.optStr(f.get("sessionId"), `${path}.sessionId`),
    note: r.optStr(f.get("note"), `${path}.note`),
    manual: r.bool(f.get("manual"), `${path}.manual`),
  };
}

function readProgram(r: Reader, v: unknown, path: string): SavedProgram {
  const f = r.obj(v, path);
  return {
    id: r.str(f.get("id"), `${path}.id`),
    template: readTemplate(r, f.get("template"), `${path}.template`),
    savedAt: r.str(f.get("savedAt"), `${path}.savedAt`),
  };
}

function readRow<T>(r: Reader, v: unknown, path: string, body: (r: Reader, v: unknown, path: string) => T): ChatEntry<T> {
  const f = r.obj(v, path);
  return { id: r.str(f.get("id"), `${path}.id`), seq: r.int(f.get("seq"), `${path}.seq`), body: body(r, f.get("body"), `${path}.body`) };
}

/**
 * Each row on its own Reader: one unreadable row is a problem named in
 * red, and the rest of the owner's history still loads.
 */
export function each<T>(raw: unknown, path: string, problems: string[], read: (r: Reader, v: unknown, path: string) => T): T[] {
  const outer = new Reader();
  const rows = outer.arr(raw, path);
  problems.push(...outer.problems);
  const out: T[] = [];
  rows.forEach((row, i) => {
    const r = new Reader();
    const value = read(r, row, `${path}[${i}]`);
    if (r.ok()) out.push(value);
    else problems.push(...r.problems);
  });
  return out;
}

export function readSnapshot(raw: unknown): Loaded {
  const r = new Reader();
  const f = r.obj(raw, "snapshot");
  const problems: string[] = [...r.problems];
  for (const p of r.arr(f.get("problems"), "snapshot.problems")) problems.push(r.text(p, "snapshot.problems[]"));
  const data: AppData = {
    version: 1,
    exercises: each(f.get("exercises"), "exercises", problems, readExercise),
    sessions: each(f.get("sessions"), "sessions", problems, readSession),
    prs: each(f.get("prs"), "prs", problems, readPR),
    programs: each(f.get("programs"), "programs", problems, readProgram),
    mimir: {
      items: each(f.get("mimirItems"), "mimirItems", problems, (rr, v, p) => readRow(rr, v, p, readChatItem)),
      messages: each(f.get("mimirMessages"), "mimirMessages", problems, (rr, v, p) => readRow(rr, v, p, readChatMessage)),
    },
  };
  return { data, problems };
}


/**
 * The JSON blob shape (AppData as JSON.stringify writes it). Programs and
 * the chat are optional: blobs written before Mímir have neither.
 */
export function readDataBlob(raw: unknown): Loaded {
  const r = new Reader();
  const f = r.obj(raw, "data");
  const problems: string[] = [];
  const mimir = r.optObj(f.get("mimir"), "data.mimir");
  const programs = f.get("programs");
  const data: AppData = {
    version: 1,
    exercises: each(f.get("exercises"), "exercises", problems, readExercise),
    sessions: each(f.get("sessions"), "sessions", problems, readSession),
    prs: each(f.get("prs"), "prs", problems, readPR),
    programs: programs === undefined ? [] : each(programs, "programs", problems, readProgram),
    mimir: {
      items: mimir ? each(mimir.get("items"), "mimir.items", problems, (rr, v, p) => readRow(rr, v, p, readChatItem)) : [],
      messages: mimir ? each(mimir.get("messages"), "mimir.messages", problems, (rr, v, p) => readRow(rr, v, p, readChatMessage)) : [],
    },
  };
  problems.unshift(...r.problems);
  return { data, problems };
}
