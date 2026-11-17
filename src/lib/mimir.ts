/**
 * Mímir: the trainer. In the myths Odin gave an eye to drink from Mímir's
 * well and came away knowing; here the well is the owner's own training
 * log, records and watch data.
 *
 * Two jobs, one conversation, an LLM through OpenRouter (openrouter.ts):
 *  - Set up a new program with the owner. The request is the spec, exactly
 *    as CLAUDE.md asks of the coding agent: station order, work and rest,
 *    rounds. Mímir writes a `Template` from built-in exercises only (each
 *    has its own animation and cues), it is checked by `templateProblems`
 *    (the same rules check:content holds the built-ins to), and only a program
 *    with no problems reaches the owner, as a card with Save.
 *  - Recommend what to do next from the history, records, the watch's
 *    readiness and the library, as a card that opens the workout.
 *
 * The model never writes to anything itself: saving is the owner's tap.
 * Everything it sends is read strictly (decode.ts): wrong types and unknown
 * fields come back to it as problems to fix, never coerced into a program.
 *
 * The chat lives in the training database (AppData.mimir), so it survives a
 * restart; only the turn in flight (busy, failure) is module state, so it
 * keeps running when the owner switches tabs.
 */
import type { AppData, ChatEntry, ChatItem, ChatMessage, Exercise, MusicProfile, Template } from "../types";
import type { MimirSettings, ToolSpec } from "./openrouter";
import { complete } from "./openrouter";
import { PROGRAM_PREFIX, templatesWith, withProgram } from "./programs";
import { templateProblems } from "./template-check";
import { exerciseGear, libraryFor } from "./library";
import { GEAR } from "./gear";
import { templateLength } from "./catalog";
import { collapsePRs, formatPR, prKindLabel } from "./prs";
import { garminSnapshot, matchSessions, typeLabel } from "./garmin";
import { loadFtp } from "./ride";
import { loadHrZones } from "./hr";
import { errorText } from "./http";
import { EX } from "./seed";
import { uid } from "./store";
import {
  INTENSITIES,
  LEVELS,
  parseJson,
  Reader,
  readEmom,
  readFlow,
  readForTime,
  readGear,
  readInterval,
  readRide,
  SET_IDS,
} from "./decode";
import type { Fields } from "./decode";

/* ------------------------------ The chat --------------------------------- */

/** Old turns fall off the front; the model needs the thread, not the archive. */
const MAX_MESSAGES = 80;
/** What the owner can scroll back through. */
const MAX_ITEMS = 200;

/** Drop the oldest messages, never splitting a tool call from its results. */
function trim<T extends { body: ChatMessage }>(messages: readonly T[], max: number): T[] {
  if (messages.length <= max) return [...messages];
  let start = messages.length - max;
  while (start < messages.length && messages[start]?.body.role !== "user") start++;
  return messages.slice(start);
}

function nextSeq(rows: readonly { seq: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
}

function entries<T>(rows: readonly ChatEntry<T>[], bodies: readonly T[]): ChatEntry<T>[] {
  const seq = nextSeq(rows);
  return [...rows, ...bodies.map((body, i) => ({ id: uid("chat"), seq: seq + i, body }))];
}

function withItems(data: AppData, items: readonly ChatItem[]): AppData {
  return { ...data, mimir: { ...data.mimir, items: entries(data.mimir.items, items).slice(-MAX_ITEMS) } };
}

function withMessages(data: AppData, messages: readonly ChatMessage[]): AppData {
  return { ...data, mimir: { ...data.mimir, messages: trim(entries(data.mimir.messages, messages), MAX_MESSAGES) } };
}

/* ---------------------------- The catalogue ------------------------------ */

/** Exercises Mímir may use: built-in, current, so every one has its own animation. */
export function usableExercises(data: AppData): Exercise[] {
  return data.exercises.filter((e) => e.builtIn && !e.deprecated);
}

function catalogue(exercises: Exercise[]): string {
  return exercises
    .map((e) => {
      const gear = exerciseGear(e.id);
      const side = libraryFor(e).side ? " · one-sided" : "";
      return `${e.id} | ${e.name} | ${e.metric} | ${gear.length ? gear.join(",") : "bodyweight"}${side}`;
    })
    .join("\n");
}

function kindOf(t: Template): string {
  return t.interval ? "interval" : t.emom ? "emom" : t.flow ? "flow" : t.forTime ? "for time" : t.ride ? "ride" : "logged";
}

/* ------------------------------ The prompt -------------------------------- */

function systemPrompt(data: AppData): string {
  const today = new Date();
  return `You are Mímir, the trainer inside Varg, a rugged offline-first military-style workout app. You talk with its one user, the owner, who trains alone with you as coach. Today is ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString("en-GB", { weekday: "long" })}).

You do two things.

1. SET UP NEW PROGRAMS. The owner describes a workout ("20 s sit-ups, cardio, push-ups… 10 s rest, 3 rounds") or asks you to design one. Their words are the spec: match station order, work and rest seconds, round count and any alternation exactly. If their arithmetic does not come out (a stated total ten seconds off), build what they asked and say so plainly; never silently round. Ask one short question only when something essential is missing; otherwise build it. Then call propose_program. It checks the program against the app's rules and either returns problems (fix them and call it again, without bothering the owner) or shows the owner a card with a Save button. Do not restate the program after the card is shown; one line on any choice you made is enough.

2. RECOMMEND. When asked what to do (today, this week), look at the facts first: get_history, get_records, get_readiness, list_workouts. Weigh recent load, what has been neglected, sleep/HRV/Body Battery, and progress. Recommend with recommend_workout (shows a card that opens the workout). Prefer the library's workouts; propose a new program only when nothing fits. Be specific: name the numbers from the history that drove the choice.

Style: short, direct, like a good coach between sets. Plain text, no markdown headings or tables. Metric units only (kg, m, km). Program names, schemes and stage labels are labels, not prose: "4 rounds · 8 stations · 40 s work / 20 s rest", "100 push-ups".

PROGRAMS. Use only exercise ids from the catalogue below; nothing else exists on the device, and every listed one has its own animation and cues. A program is ONE of these kinds (set exactly one of interval, emom, flow, forTime, ride, or none for a logged session):

- interval: a guided circuit. exerciseIds are the stations in order; interval {work, rest, rounds} in whole seconds (work 5-600, rest 0-600, rounds 1-50, at most 200 station-steps, at most 2 h). Each station is timed work, so only time-friendly exercises; no reps, no distances. The scheme is written for you.
- emom: every minute on the minute. emom {minute (usually 60), rounds, stations: [{exerciseId, reps: [one whole count per round] OR seconds: [one per round, under the minute], perSide?: "leg"|"arm" (reps then even), focus?: "what it trains"}], warmup?: [{exerciseId, seconds}] run back to back first, total warm-up a multiple of 20 s}. Reps only for reps/weight_reps exercises, seconds only for time exercises. Never a range. The scheme is written for you.
- flow: yoga. flow {steps: [{exerciseId, seconds 10-300, side?: "left"|"right"}], transition: seconds 0-60 to move between poses}. A one-sided pose comes as a left step immediately followed by the same pose right, same hold. The scheme is written for you.
- forTime: a fixed amount of work scored by time. forTime {stages: [{exerciseId, label, reps? | meters?}]}: reps for reps/weight_reps exercises, meters for distance_time; the label states that number ("21 kettlebell swings", "400 m run" or "1.6 km run"). Write a scheme like "3 rounds: 400 m run · 21 kettlebell swings @ 24/16 kg · for time". Needs estimateMinutes.
- ride: indoor bike, exerciseIds ["ex-spin-bike"]. ride {segments: [{label, ftp: [low%, high%], seconds | kcal, cadence?: [lo, hi], hrZone?: 1-5}], race?: true when any segment is kcal}. hrZone segments are at least 180 s and the scheme must say "heart-rate zone N". Watts follow the owner's FTP (${loadFtp()} W now).
- none: a logged session (strength work, sets written in by hand). exerciseIds are the exercises; describe sets × reps and loads in the scheme ("5 × 5 @ 80 % 1RM · 3 × 8"). Needs estimateMinutes.

Every program: name (short, title case), description (one or two sentences: what and why), scheme, level (beginner | intermediate | advanced), estimateMinutes only for forTime and logged (and kcal rides). Optional gear {extra?: gear ids no exercise implies, detail?: {gearId: "24/16 kg"}} for gear the workout uses; gear ids: ${Object.keys(GEAR).join(", ")}. Optional music {energy?: 1 low | 2 mid | 3 peak (mobility 1, default 3), style?: genre tags for its own battle track, theme?: one line of mood}.

To change one of the owner's saved programs (ids starting "${PROGRAM_PREFIX}"), pass its id as replaces.

EXERCISE CATALOGUE (id | name | metric | gear | one-sided):
${catalogue(usableExercises(data))}`;
}

/* ------------------------------- The tools -------------------------------- */

const TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_history",
      description: "The owner's finished sessions, newest first: what was done, sets, duration, heart rate; plus watch activities Varg did not log (runs, rides elsewhere).",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "How far back, default 42, max 365." } },
      },
    },
  },
  {
    type: "function",
    function: { name: "get_records", description: "Every personal record the owner holds, with its date.", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: {
      name: "get_readiness",
      description: "Last night's sleep, HRV, Body Battery and resting HR from Garmin, plus FTP and heart-rate zones.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_workouts",
      description: "Every workout in the library (built-ins and the owner's saved programs): id, name, kind, level, length, exercises, scheme.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_program",
      description: "Check a program against the app's rules. Returns the problems to fix, or shows the owner a card with Save.",
      parameters: {
        type: "object",
        properties: {
          program: { type: "object", description: "The program, in the format from the instructions." },
          replaces: { type: "string", description: "Id of the owner's saved program this replaces, if any." },
        },
        required: ["program"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_workout",
      description: "Show the owner a card for a library workout, with a button that opens it.",
      parameters: {
        type: "object",
        properties: {
          templateId: { type: "string" },
          why: { type: "string", description: "One short line: why this one, now." },
        },
        required: ["templateId", "why"],
      },
    },
  },
];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function getHistory(data: AppData, args: Fields): string {
  const asked = args.get("days");
  const days = typeof asked === "number" && Number.isInteger(asked) ? Math.min(365, Math.max(1, asked)) : 42;
  const since = Date.now() - days * 86400_000;
  const exName = new Map(data.exercises.map((e) => [e.id, e.name]));
  const finished = data.sessions
    .filter((s) => s.finishedAt && new Date(s.date).getTime() >= since)
    .sort((a, b) => b.date.localeCompare(a.date));
  const garmin = garminSnapshot();
  const matches = matchSessions(finished, garmin.activities);
  const matched = new Set([...matches.values()].map((a) => a.id));
  const sessions = finished.map((s) => {
    const start = new Date(s.date).getTime();
    const minutes = s.finishedAt ? Math.round((new Date(s.finishedAt).getTime() - start) / 60000) : undefined;
    const entries = s.entries.map((e) => {
      const sets = e.sets.filter((x) => x.done).map((x) =>
        [
          x.weight != null ? `${x.weight}kg` : "",
          x.reps != null ? `×${x.reps}` : "",
          x.seconds != null ? `${Math.round(x.seconds)}s` : "",
          x.meters != null ? `${x.meters}m` : "",
          x.rpe != null ? `@RPE${x.rpe}` : "",
        ].join(""));
      return `${exName.get(e.exerciseId) ?? e.exerciseId}: ${sets.join(", ") || "no sets done"}`;
    });
    const watch = matches.get(s.id);
    const hr = watch?.avgHr ? `HR avg ${watch.avgHr} max ${watch.maxHr ?? "?"} (watch)`
      : s.heartRate ? `HR avg ${s.heartRate.avg} max ${s.heartRate.max} (strap)` : "";
    return { date: s.date.slice(0, 16), name: s.name, templateId: s.templateId, minutes, hr: hr || undefined, kcal: watch?.kcal, note: s.note, entries };
  });
  const other = garmin.activities
    .filter((a) => a.start >= since && !matched.has(a.id))
    .sort((a, b) => b.start - a.start)
    .map((a) => ({
      date: day(a.start),
      type: typeLabel(a.type),
      name: a.name,
      minutes: Math.round(a.seconds / 60),
      km: a.meters ? Math.round(a.meters / 100) / 10 : undefined,
      avgHr: a.avgHr,
      avgPower: a.avgPower,
    }));
  return JSON.stringify({ days, sessions, watchActivitiesNotInVarg: other, garminConnected: garmin.lastSync !== undefined });
}

function getRecords(data: AppData): string {
  const exName = new Map(data.exercises.map((e) => [e.id, e.name]));
  return JSON.stringify(
    collapsePRs(data.prs).map((r) => ({
      exercise: exName.get(r.exerciseId) ?? r.exerciseId,
      kind: prKindLabel(r.kind),
      value: formatPR(r.best),
      date: r.best.date.slice(0, 10),
    })),
  );
}

function getReadiness(): string {
  const g = garminSnapshot();
  return JSON.stringify({
    garmin: g.lastSync ? { readiness: g.readiness, lastSync: g.lastSync, error: g.error } : "not connected",
    ftpWatts: loadFtp(),
    hrZones: loadHrZones() ?? "not set",
  });
}

function listWorkouts(data: AppData): string {
  const saved = new Set(data.programs.map((p) => p.id));
  return JSON.stringify(
    templatesWith(data.programs).map((t) => {
      const len = templateLength(t);
      return {
        id: t.id,
        name: t.name,
        kind: kindOf(t),
        level: t.level,
        minutes: len ? Math.round(len.seconds / 60) : undefined,
        scheme: t.scheme,
        exercises: [...new Set(t.exerciseIds)].length,
        ...(saved.has(t.id) ? { owners: true, program: t } : {}),
      };
    }),
  );
}

/* ------------------------ Reading the model's program ---------------------- */

/** Every field a program may carry. Anything else is named back to the model. */
const PROGRAM_FIELDS: readonly string[] = [
  "name", "description", "level", "scheme", "exerciseIds", "estimateMinutes",
  "interval", "emom", "flow", "forTime", "ride", "gear", "music",
];
const KINDS: readonly ("interval" | "emom" | "flow" | "forTime" | "ride")[] = ["interval", "emom", "flow", "forTime", "ride"];

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
const unique = (xs: readonly string[]) => [...new Set(xs)];

/**
 * Turn the model's JSON into a Template, strictly: every field is checked for
 * its type, nothing is coerced, and unknown fields are refused. Problems come
 * back as text the model can act on. The id, and the schemes the guided
 * players compute, are written here rather than trusted to the model's
 * arithmetic.
 */
export function readProgram(raw: unknown, id: string): { template?: Template; problems: string[] } {
  let value = raw;
  if (typeof raw === "string") {
    const parsed = parseJson(raw);
    if (!parsed.ok) return { problems: [`program is not valid JSON: ${parsed.error}`] };
    value = parsed.value;
  }
  const r = new Reader();
  const p = r.obj(value, "program");
  if (!r.ok()) return { problems: r.problems };
  for (const key of p.keys()) {
    if (!PROGRAM_FIELDS.includes(key)) r.fail(`program.${key} is not a field a program has`);
  }
  const present = (k: string) => {
    const v = p.get(k);
    return v !== undefined && v !== null;
  };
  const kinds = KINDS.filter(present);
  if (kinds.length > 1) r.fail(`set only one of interval, emom, flow, forTime, ride (got ${kinds.join(", ")})`);

  const description = r.str(p.get("description"), "description", 600);
  const t: Template = {
    id,
    name: r.str(p.get("name"), "name", 60),
    branch: "Mímir",
    description,
    scheme: "",
    level: r.oneOf(p.get("level"), LEVELS, "level"),
    exerciseIds: [],
    music: { bpm: 140, style: "", theme: "" },
  };

  switch (kinds[0]) {
    case "interval": {
      t.exerciseIds = r.strs(p.get("exerciseIds"), "exerciseIds");
      const iv = readInterval(r, r.obj(p.get("interval"), "interval"), "interval");
      t.interval = iv;
      t.scheme = `${iv.rounds} rounds · ${t.exerciseIds.length} stations · ${iv.work} s work / ${iv.rest} s rest`;
      break;
    }
    case "emom": {
      const em = readEmom(r, r.obj(p.get("emom"), "emom"), "emom", 60);
      t.emom = em;
      const warmup = em.warmup ?? [];
      t.exerciseIds = unique([...warmup.map((w) => w.exerciseId), ...em.stations.map((s) => s.exerciseId)]);
      const warm = warmup.reduce((a, w) => a + w.seconds, 0);
      const main = em.rounds * em.stations.length * em.minute;
      t.scheme = [fmt(warm + main), ...(warm > 0 ? [`${fmt(warm)} warm-up`] : []), `${fmt(main)} EMOM`, `${em.rounds} rounds`, `${em.stations.length} stations`].join(" · ");
      break;
    }
    case "flow": {
      const fl = readFlow(r, r.obj(p.get("flow"), "flow"), "flow");
      t.flow = fl;
      t.exerciseIds = unique(fl.steps.map((s) => s.exerciseId));
      if (fl.steps.length > 0) {
        const total = fl.steps.reduce((a, s) => a + s.seconds, 0) + (fl.steps.length - 1) * fl.transition;
        const holds = fl.steps.map((s) => s.seconds);
        t.scheme = [
          `${fmt(total)} flow`,
          `${fl.steps.length} poses`,
          `holds of ${Math.min(...holds)}–${Math.max(...holds)} s`,
          ...(fl.transition > 0 ? [`${fl.transition} s to move between poses`] : []),
        ].join(" · ");
      }
      t.music.energy = 1;
      break;
    }
    case "forTime": {
      const ft = readForTime(r, r.obj(p.get("forTime"), "forTime"), "forTime");
      t.forTime = ft;
      t.exerciseIds = unique(ft.stages.map((s) => s.exerciseId));
      t.scheme = r.str(p.get("scheme"), "scheme", 200);
      break;
    }
    case "ride": {
      t.ride = readRide(r, r.obj(p.get("ride"), "ride"), "ride");
      t.exerciseIds = present("exerciseIds") ? r.strs(p.get("exerciseIds"), "exerciseIds") : [EX.spinBike];
      t.scheme = r.str(p.get("scheme"), "scheme", 200);
      break;
    }
    case undefined: {
      t.exerciseIds = r.strs(p.get("exerciseIds"), "exerciseIds");
      if (t.exerciseIds.length === 0) r.fail("a logged session needs exerciseIds");
      t.scheme = r.str(p.get("scheme"), "scheme", 200);
      break;
    }
  }

  const estimate = r.optInt(p.get("estimateMinutes"), "estimateMinutes");
  if (estimate !== undefined) t.estimateMinutes = estimate;
  const gear = r.optObj(p.get("gear"), "gear");
  if (gear) t.gear = readGear(r, gear, "gear");

  const m = r.optObj(p.get("music"), "music");
  const music: MusicProfile = {
    bpm: t.flow ? 70 : 140,
    style: (m && r.optStr(m.get("style"), "music.style", 200)) ?? (t.flow ? "calm ambient, soft pads, slow and spacious, no vocals" : "hard electronic, heavy drums, dark synth bass, no vocals"),
    theme: (m && r.optStr(m.get("theme"), "music.theme", 200)) ?? description,
  };
  const energy = (m && r.optOneOf(m.get("energy"), INTENSITIES, "music.energy")) ?? t.music.energy;
  const set = m && r.optOneOf(m.get("set"), SET_IDS, "music.set");
  if (energy !== undefined) music.energy = energy;
  if (set !== undefined) music.set = set;
  t.music = music;

  return r.ok() ? { template: t, problems: [] } : { problems: r.problems };
}

function newProgramId(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "program";
  return `${PROGRAM_PREFIX}${slug}-${Date.now().toString(36)}`;
}

function proposeProgram(data: AppData, args: Fields, emit: (item: ChatItem) => void): string {
  const asked = args.get("replaces");
  const replaces = typeof asked === "string" && asked !== "" ? asked : undefined;
  if (replaces !== undefined && !data.programs.some((p) => p.id === replaces)) {
    return JSON.stringify({ ok: false, problems: [`replaces: "${replaces}" is not one of the owner's saved programs`] });
  }
  const program = args.get("program");
  const r = new Reader();
  const name = typeof program === "object" && program !== null ? r.obj(program, "program").get("name") : undefined;
  const read = readProgram(program, replaces ?? newProgramId(typeof name === "string" ? name : "program"));
  const template = read.template;
  const problems = template ? templateProblems(template, usableExercises(data)) : read.problems;
  if (!template || problems.length > 0) return JSON.stringify({ ok: false, problems });
  emit(replaces === undefined ? { kind: "program", template } : { kind: "program", template, replaces });
  const len = templateLength(template);
  return JSON.stringify({
    ok: true,
    shown: "The owner sees the program as a card with Save. Do not restate it.",
    scheme: template.scheme,
    minutes: len ? Math.round(len.seconds / 60) : undefined,
  });
}

function recommend(data: AppData, args: Fields, emit: (item: ChatItem) => void): string {
  const id = args.get("templateId");
  const why = args.get("why");
  const t = typeof id === "string" ? templatesWith(data.programs).find((x) => x.id === id) : undefined;
  if (!t) return JSON.stringify({ ok: false, problem: `no workout with id ${JSON.stringify(id)}; call list_workouts` });
  emit({ kind: "pick", templateId: t.id, why: typeof why === "string" ? why : "" });
  return JSON.stringify({ ok: true, shown: `A card for ${t.name}.` });
}

/* -------------------------------- A turn ---------------------------------- */

/** Tool rounds per owner message: enough to read, propose, fix, re-propose. */
const MAX_STEPS = 10;

/**
 * Answer one owner message. Calls `emit` for every item the owner should
 * see as it happens, and returns the messages this turn added to the
 * model's history. Throws on a gateway failure; the caller shows it in red.
 */
export async function runTurn(
  settings: MimirSettings,
  data: AppData,
  history: readonly ChatMessage[],
  text: string,
  emit: (item: ChatItem) => void,
  onTool?: (name: string) => void,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const added: ChatMessage[] = [{ role: "user", content: text }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await complete(settings, [{ role: "system", content: systemPrompt(data) }, ...history, ...added], TOOLS, signal);
    added.push(reply);
    const said = reply.content?.trim();
    if (said) emit({ kind: "mimir", text: said });
    if (!reply.tool_calls?.length) return added;
    for (const call of reply.tool_calls) {
      onTool?.(call.function.name);
      let result: string;
      const parsed = parseJson(call.function.arguments.trim() === "" ? "{}" : call.function.arguments);
      if (!parsed.ok) {
        result = JSON.stringify({ ok: false, problem: `arguments are not valid JSON: ${parsed.error}` });
      } else {
        const r = new Reader();
        const args = r.obj(parsed.value, "arguments");
        try {
          result = r.ok() ? runTool(call.function.name, args, data, emit) : JSON.stringify({ ok: false, problems: r.problems });
        } catch (e) {
          result = JSON.stringify({ ok: false, problem: `tool failed: ${errorText(e)}` });
        }
      }
      added.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  emit({ kind: "error", text: `Stopped after ${MAX_STEPS} steps` });
  return added;
}

function runTool(name: string, args: Fields, data: AppData, emit: (item: ChatItem) => void): string {
  switch (name) {
    case "get_history": return getHistory(data, args);
    case "get_records": return getRecords(data);
    case "get_readiness": return getReadiness();
    case "list_workouts": return listWorkouts(data);
    case "propose_program": return proposeProgram(data, args, emit);
    case "recommend_workout": return recommend(data, args, emit);
    default: return JSON.stringify({ ok: false, problem: `no tool "${name}"` });
  }
}

/** What each tool is doing, as a status label. */
export const TOOL_LABEL: Readonly<Partial<Record<string, string>>> = {
  get_history: "Reading the Saga",
  get_records: "Reading records",
  get_readiness: "Reading the watch",
  list_workouts: "Reading the library",
  propose_program: "Checking program",
  recommend_workout: "Picking",
};

/* ------------------------------ The live chat ------------------------------ */
// Only the turn in flight is module state: the chat itself is AppData,
// written through `update` like a logged set, so it reaches the database
// and its failures show in the same red banner.

export interface TurnState {
  /** Set while a turn runs: what Mímir is doing, as a label. */
  busy: string | null;
  /** The last turn failed: the reason, and the message to send again. */
  failure: { text: string; message: string } | null;
}

let turn: TurnState = { busy: null, failure: null };
const turnListeners = new Set<() => void>();
let abort: AbortController | null = null;

function setTurn(patch: Partial<TurnState>): void {
  turn = { ...turn, ...patch };
  for (const l of turnListeners) l();
}

export function subscribeTurn(l: () => void): () => void {
  turnListeners.add(l);
  return () => { turnListeners.delete(l); };
}

export function turnSnapshot(): TurnState {
  return turn;
}

type Update = (fn: (data: AppData) => AppData) => void;

/** Send the owner's message. Failures land in `failure`, in red, with Retry. */
export async function send(settings: MimirSettings, data: AppData, update: Update, text: string, retry = false): Promise<void> {
  const message = text.trim();
  if (turn.busy !== null || message === "") return;
  const controller = new AbortController();
  abort = controller;
  if (!retry) update((d) => withItems(d, [{ kind: "user", text: message }]));
  setTurn({ busy: "Thinking", failure: null });
  try {
    const added = await runTurn(
      settings,
      data,
      data.mimir.messages.map((m) => m.body),
      message,
      (item) => { update((d) => withItems(d, [item])); },
      (tool) => { setTurn({ busy: TOOL_LABEL[tool] ?? "Thinking" }); },
      controller.signal,
    );
    update((d) => withMessages(d, added));
    setTurn({ busy: null });
  } catch (e) {
    setTurn({ busy: null, failure: controller.signal.aborted ? null : { text: errorText(e), message } });
  } finally {
    abort = null;
  }
}

export function stop(): void {
  abort?.abort();
}

/** Save a proposed program and mark its card saved, in one update. */
export function saveFromChat(update: Update, itemId: string, template: Template): void {
  update((d) => {
    const next = withProgram(d, template, new Date().toISOString());
    return {
      ...next,
      mimir: {
        ...next.mimir,
        items: next.mimir.items.map((it) => (it.id === itemId && it.body.kind === "program" ? { ...it, body: { ...it.body, saved: true } } : it)),
      },
    };
  });
}

export function clearChat(update: Update): void {
  if (turn.busy !== null) return;
  update((d) => ({ ...d, mimir: { items: [], messages: [] } }));
}
