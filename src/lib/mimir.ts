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
 *    (the same rules db:smoke holds the built-ins to), and only a program
 *    with no problems reaches the owner, as a card with Save.
 *  - Recommend what to do next from the history, records, the watch's
 *    readiness and the library, as a card that opens the workout.
 *
 * The model never writes to anything itself: saving is the owner's tap.
 */
import type { AppData, EmomStation, Exercise, FlowStep, ForTimeStage, Level, RideSegment, Template } from "../types";
import type { ChatMessage, MimirSettings, ToolSpec } from "./openrouter";
import { complete } from "./openrouter";
import { allTemplates, loadPrograms, PROGRAM_PREFIX, templateById } from "./programs";
import { templateProblems } from "./template-check";
import { exerciseGear, libraryFor } from "./library";
import { GEAR, type GearId } from "./gear";
import { templateLength } from "./catalog";
import { collapsePRs, formatPR, prKindLabel } from "./prs";
import { garminSnapshot, matchSessions, typeLabel } from "./garmin";
import { loadFtp } from "./ride";
import { loadHrZones } from "./hr";
import { SETS } from "./songs";
import { errorText } from "./http";

/* ------------------------------ The chat --------------------------------- */

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "mimir"; text: string }
  | { kind: "program"; template: Template; replaces?: string | undefined; saved?: boolean | undefined }
  | { kind: "pick"; templateId: string; why: string }
  | { kind: "error"; text: string };

export interface Chat {
  /** What the owner sees. */
  items: ChatItem[];
  /** What the model sees: the API history, tool calls and results included. */
  messages: ChatMessage[];
}

const CHAT_KEY = "varg.mimir.chat.v1";
/** Old turns fall off the front; the model needs the thread, not the archive. */
const MAX_MESSAGES = 80;

export function loadChat(): Chat {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<Chat>;
      if (Array.isArray(c.items) && Array.isArray(c.messages)) return { items: c.items, messages: c.messages };
    }
  } catch {
    // a fresh chat
  }
  return { items: [], messages: [] };
}

export function saveChat(chat: Chat): void {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chat));
  } catch {
    // kept in memory for this run
  }
}

/** Drop the oldest turns, never splitting a tool call from its results. */
function trim(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  let start = messages.length - MAX_MESSAGES;
  while (start < messages.length && messages[start]?.role !== "user") start++;
  return messages.slice(start);
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
- ride: indoor bike, exerciseIds ["ex-spin-bike"]. ride {segments: [{label, ftp: [low%, high%], seconds | kcal, cadence?: [lo, hi], hrZone?: 1-5}], race?: true when any segment is kcal}. hrZone segments are at least 180 s and the scheme must say "heart-rate zone N". Watts follow the owner's FTP (${String(loadFtp())} W now).
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

function getHistory(data: AppData, args: Obj): string {
  const days = Math.min(365, Math.max(1, Math.round(Number(args.days) || 42)));
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
          x.weight != null ? `${String(x.weight)}kg` : "",
          x.reps != null ? `×${String(x.reps)}` : "",
          x.seconds != null ? `${String(Math.round(x.seconds))}s` : "",
          x.meters != null ? `${String(x.meters)}m` : "",
          x.rpe != null ? `@RPE${String(x.rpe)}` : "",
        ].join(""));
      return `${exName.get(e.exerciseId) ?? e.exerciseId}: ${sets.join(", ") || "no sets done"}`;
    });
    const watch = matches.get(s.id);
    const hr = watch?.avgHr ? `HR avg ${String(watch.avgHr)} max ${String(watch.maxHr ?? "?")} (watch)`
      : s.heartRate ? `HR avg ${String(s.heartRate.avg)} max ${String(s.heartRate.max)} (strap)` : "";
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

function listWorkouts(): string {
  const saved = new Set(loadPrograms().map((p) => p.template.id));
  return JSON.stringify(
    allTemplates().map((t) => {
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

/** The fields Mímir's JSON may carry, every one unchecked until read. */
type Key = "cadence"
  | "days"
  | "description"
  | "detail"
  | "emom"
  | "energy"
  | "estimateMinutes"
  | "exerciseId"
  | "exerciseIds"
  | "extra"
  | "flow"
  | "focus"
  | "forTime"
  | "ftp"
  | "gear"
  | "hrZone"
  | "interval"
  | "kcal"
  | "label"
  | "level"
  | "meters"
  | "minute"
  | "music"
  | "name"
  | "perSide"
  | "program"
  | "race"
  | "replaces"
  | "reps"
  | "rest"
  | "ride"
  | "rounds"
  | "scheme"
  | "seconds"
  | "segments"
  | "set"
  | "side"
  | "stages"
  | "stations"
  | "steps"
  | "style"
  | "templateId"
  | "theme"
  | "transition"
  | "warmup"
  | "why"
  | "work";
type Obj = Partial<Record<Key, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Turn the model's JSON into a Template, strictly: every field is checked for
 * its type and nothing unknown is carried over. Problems come back as text
 * the model can act on. Ids, and the schemes the guided players compute,
 * are written here rather than trusted to the model's arithmetic.
 */
export function readProgram(raw: unknown, id: string): { template?: Template; problems: string[] } {
  const problems: string[] = [];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { problems: ["program is not valid JSON"] };
    }
  }
  if (!isObj(raw)) return { problems: ["program must be an object"] };
  const p = raw;

  const str = (v: unknown, what: string, max = 400): string => {
    if (typeof v === "string" && v.trim() && v.length <= max) return v.trim();
    problems.push(`${what} must be a non-empty string of at most ${String(max)} characters`);
    return "";
  };
  const int = (v: unknown, what: string): number => {
    if (typeof v === "number" && Number.isInteger(v)) return v;
    problems.push(`${what} must be a whole number`);
    return 0;
  };
  const ints = (v: unknown, what: string): number[] => {
    if (Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isInteger(n))) return v as number[];
    problems.push(`${what} must be an array of whole numbers, one per round`);
    return [];
  };
  const pair = (v: unknown, what: string): [number, number] => {
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")) return [Number(v[0]), Number(v[1])];
    problems.push(`${what} must be [low, high]`);
    return [0, 0];
  };
  const list = (v: unknown, what: string): unknown[] => {
    if (Array.isArray(v)) return v;
    problems.push(`${what} must be an array`);
    return [];
  };
  const optInt = (v: unknown, what: string): number | undefined => (v === undefined || v === null ? undefined : int(v, what));

  const name = str(p.name, "name", 60);
  const description = str(p.description, "description", 600);
  const level = p.level as Level;
  if (!["beginner", "intermediate", "advanced"].includes(level)) problems.push("level must be beginner, intermediate or advanced");

  const kinds = (["interval", "emom", "flow", "forTime", "ride"] as const).filter((k) => p[k] !== undefined && p[k] !== null);
  if (kinds.length > 1) problems.push(`set only one of interval, emom, flow, forTime, ride (got ${kinds.join(", ")})`);

  const t: Template = {
    id,
    name,
    branch: "Mímir",
    description,
    scheme: "",
    level,
    exerciseIds: [],
    music: { bpm: 140, style: "", theme: "" },
  };
  const ids = (v: unknown, what: string): string[] => {
    const xs = list(v, what);
    if (!xs.every((x) => typeof x === "string")) problems.push(`${what} must be exercise ids`);
    return xs.filter((x): x is string => typeof x === "string");
  };
  const unique = (xs: string[]) => [...new Set(xs)];
  const fmt = (s: number) => `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;

  const kind = kinds[0];
  if (kind === "interval") {
    const iv = isObj(p.interval) ? p.interval : {};
    t.exerciseIds = ids(p.exerciseIds, "exerciseIds (the stations in order)");
    t.interval = { work: int(iv.work, "interval.work"), rest: int(iv.rest, "interval.rest"), rounds: int(iv.rounds, "interval.rounds") };
    t.scheme = `${String(t.interval.rounds)} rounds · ${String(t.exerciseIds.length)} stations · ${String(t.interval.work)} s work / ${String(t.interval.rest)} s rest`;
  } else if (kind === "emom") {
    const em = isObj(p.emom) ? p.emom : {};
    const stations: EmomStation[] = list(em.stations, "emom.stations").map((x, i) => {
      const s = isObj(x) ? x : {};
      const at = `emom.stations[${String(i)}]`;
      const st: EmomStation = { exerciseId: str(s.exerciseId, `${at}.exerciseId`) };
      if (s.reps !== undefined) st.reps = ints(s.reps, `${at}.reps`);
      if (s.seconds !== undefined) st.seconds = ints(s.seconds, `${at}.seconds`);
      if (s.perSide === "leg" || s.perSide === "arm") st.perSide = s.perSide;
      else if (s.perSide !== undefined) problems.push(`${at}.perSide must be "leg" or "arm"`);
      if (typeof s.focus === "string" && s.focus.trim()) st.focus = s.focus.trim();
      return st;
    });
    const warmup = em.warmup === undefined ? [] : list(em.warmup, "emom.warmup").map((x, i) => {
      const w = isObj(x) ? x : {};
      return { exerciseId: str(w.exerciseId, `emom.warmup[${String(i)}].exerciseId`), seconds: int(w.seconds, `emom.warmup[${String(i)}].seconds`) };
    });
    t.emom = { minute: em.minute === undefined ? 60 : int(em.minute, "emom.minute"), rounds: int(em.rounds, "emom.rounds"), stations, ...(warmup.length ? { warmup } : {}) };
    t.exerciseIds = unique([...warmup.map((w) => w.exerciseId), ...stations.map((s) => s.exerciseId)]);
    const warm = warmup.reduce((a, w) => a + w.seconds, 0);
    const main = t.emom.rounds * stations.length * t.emom.minute;
    t.scheme = [fmt(warm + main), ...(warm > 0 ? [`${fmt(warm)} warm-up`] : []), `${fmt(main)} EMOM`, `${String(t.emom.rounds)} rounds`, `${String(stations.length)} stations`].join(" · ");
  } else if (kind === "flow") {
    const fl = isObj(p.flow) ? p.flow : {};
    const steps: FlowStep[] = list(fl.steps, "flow.steps").map((x, i) => {
      const s = isObj(x) ? x : {};
      const at = `flow.steps[${String(i)}]`;
      const st: FlowStep = { exerciseId: str(s.exerciseId, `${at}.exerciseId`), seconds: int(s.seconds, `${at}.seconds`) };
      if (s.side === "left" || s.side === "right") st.side = s.side;
      else if (s.side !== undefined && s.side !== null) problems.push(`${at}.side must be "left" or "right"`);
      return st;
    });
    t.flow = { steps, transition: int(fl.transition, "flow.transition") };
    t.exerciseIds = unique(steps.map((s) => s.exerciseId));
    if (steps.length > 0) {
      const total = steps.reduce((a, s) => a + s.seconds, 0) + (steps.length - 1) * t.flow.transition;
      const holds = steps.map((s) => s.seconds);
      t.scheme = [
        `${fmt(total)} flow`,
        `${String(steps.length)} poses`,
        `holds of ${String(Math.min(...holds))}–${String(Math.max(...holds))} s`,
        ...(t.flow.transition > 0 ? [`${String(t.flow.transition)} s to move between poses`] : []),
      ].join(" · ");
    }
    t.music.energy = 1;
  } else if (kind === "forTime") {
    const ft = isObj(p.forTime) ? p.forTime : {};
    const stages: ForTimeStage[] = list(ft.stages, "forTime.stages").map((x, i) => {
      const s = isObj(x) ? x : {};
      const at = `forTime.stages[${String(i)}]`;
      const st: ForTimeStage = { exerciseId: str(s.exerciseId, `${at}.exerciseId`), label: str(s.label, `${at}.label`, 60) };
      const reps = optInt(s.reps, `${at}.reps`);
      const meters = optInt(s.meters, `${at}.meters`);
      if (reps !== undefined) st.reps = reps;
      if (meters !== undefined) st.meters = meters;
      return st;
    });
    t.forTime = { stages };
    t.exerciseIds = unique(stages.map((s) => s.exerciseId));
    t.scheme = str(p.scheme, "scheme", 200);
  } else if (kind === "ride") {
    const r = isObj(p.ride) ? p.ride : {};
    const segments: RideSegment[] = list(r.segments, "ride.segments").map((x, i) => {
      const s = isObj(x) ? x : {};
      const at = `ride.segments[${String(i)}]`;
      const sg: RideSegment = { label: str(s.label, `${at}.label`, 40), ftp: pair(s.ftp, `${at}.ftp`) };
      const seconds = optInt(s.seconds, `${at}.seconds`);
      const kcal = optInt(s.kcal, `${at}.kcal`);
      const hrZone = optInt(s.hrZone, `${at}.hrZone`);
      if (seconds !== undefined) sg.seconds = seconds;
      if (kcal !== undefined) sg.kcal = kcal;
      if (hrZone !== undefined) sg.hrZone = hrZone;
      if (s.cadence !== undefined && s.cadence !== null) sg.cadence = pair(s.cadence, `${at}.cadence`);
      return sg;
    });
    t.ride = { segments, ...(p.ride && isObj(p.ride) && p.ride.race === true ? { race: true } : {}) };
    t.exerciseIds = ids(p.exerciseIds ?? ["ex-spin-bike"], "exerciseIds");
    t.scheme = str(p.scheme, "scheme", 200);
  } else {
    t.exerciseIds = ids(p.exerciseIds, "exerciseIds");
    if (t.exerciseIds.length === 0) problems.push("a logged session needs exerciseIds");
    t.scheme = str(p.scheme, "scheme", 200);
  }

  if (p.estimateMinutes !== undefined && p.estimateMinutes !== null) t.estimateMinutes = int(p.estimateMinutes, "estimateMinutes");

  if (p.gear !== undefined && p.gear !== null) {
    const g = isObj(p.gear) ? p.gear : {};
    const extra = g.extra === undefined ? [] : list(g.extra, "gear.extra").filter((x): x is GearId => typeof x === "string" && x in GEAR);
    const detail: Partial<Record<GearId, string>> = {};
    if (isObj(g.detail)) {
      for (const [k, v] of Object.entries(g.detail)) {
        if (!(k in GEAR)) problems.push(`gear.detail: unknown gear "${k}"`);
        else if (typeof v === "string") detail[k as GearId] = v;
      }
    }
    t.gear = { ...(extra.length ? { extra } : {}), ...(Object.keys(detail).length ? { detail } : {}) };
  }

  const m = isObj(p.music) ? p.music : {};
  const energy = m.energy ?? t.music.energy;
  if (energy !== undefined) {
    if (energy === 1 || energy === 2 || energy === 3) t.music.energy = energy;
    else problems.push("music.energy must be 1, 2 or 3");
  }
  t.music.style = typeof m.style === "string" && m.style.trim() ? m.style.trim().slice(0, 200)
    : t.flow ? "calm ambient, soft pads, slow and spacious, no vocals" : "hard electronic, heavy drums, dark synth bass, no vocals";
  t.music.theme = typeof m.theme === "string" && m.theme.trim() ? m.theme.trim().slice(0, 200) : description;
  t.music.bpm = t.flow ? 70 : 140;
  if (typeof m.set === "string" && SETS.some((s) => s.id === m.set)) t.music.set = m.set as NonNullable<Template["music"]["set"]>;

  return problems.length ? { problems } : { template: t, problems };
}

function newProgramId(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "program";
  return `${PROGRAM_PREFIX}${slug}-${Date.now().toString(36)}`;
}

function proposeProgram(data: AppData, args: Obj, emit: (item: ChatItem) => void): string {
  const replaces = typeof args.replaces === "string" && args.replaces ? args.replaces : undefined;
  if (replaces && !loadPrograms().some((p) => p.template.id === replaces)) {
    return JSON.stringify({ ok: false, problems: [`replaces: "${replaces}" is not one of the owner's saved programs`] });
  }
  const name = isObj(args.program) && typeof args.program.name === "string" ? args.program.name : "program";
  const read = readProgram(args.program, replaces ?? newProgramId(name));
  const template = read.template;
  const problems = template ? templateProblems(template, usableExercises(data)) : read.problems;
  if (!template || problems.length > 0) return JSON.stringify({ ok: false, problems });
  emit({ kind: "program", template, replaces });
  const len = templateLength(template);
  return JSON.stringify({
    ok: true,
    shown: "The owner sees the program as a card with Save. Do not restate it.",
    scheme: template.scheme,
    minutes: len ? Math.round(len.seconds / 60) : undefined,
  });
}

function recommend(args: Obj, emit: (item: ChatItem) => void): string {
  const id = typeof args.templateId === "string" ? args.templateId : "";
  const t = templateById(id);
  if (!t) return JSON.stringify({ ok: false, problem: `no workout with id "${id}"; call list_workouts` });
  emit({ kind: "pick", templateId: id, why: typeof args.why === "string" ? args.why : "" });
  return JSON.stringify({ ok: true, shown: `A card for ${t.name}.` });
}

/* -------------------------------- A turn ---------------------------------- */

/** Tool rounds per owner message: enough to read, propose, fix, re-propose. */
const MAX_STEPS = 10;

/**
 * Answer one owner message. Calls `emit` for every item the owner should
 * see as it happens, and returns the model's history to keep. Throws on a
 * gateway failure; the caller shows it in red.
 */
export async function runTurn(
  settings: MimirSettings,
  data: AppData,
  history: ChatMessage[],
  text: string,
  emit: (item: ChatItem) => void,
  onTool?: (name: string) => void,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  let messages: ChatMessage[] = [...trim(history), { role: "user", content: text }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await complete(settings, [{ role: "system", content: systemPrompt(data) }, ...messages], TOOLS, signal);
    messages = [...messages, reply];
    if (reply.content?.trim()) emit({ kind: "mimir", text: reply.content.trim() });
    if (!reply.tool_calls?.length) return messages;
    for (const call of reply.tool_calls) {
      onTool?.(call.function.name);
      let args: Obj = {};
      let result: string;
      try {
        const parsed: unknown = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        if (isObj(parsed)) args = parsed;
        result = runTool(call.function.name, args, data, emit);
      } catch (e) {
        result = JSON.stringify({ ok: false, problem: `tool failed: ${errorText(e)}` });
      }
      messages = [...messages, { role: "tool", tool_call_id: call.id, content: result }];
    }
  }
  emit({ kind: "error", text: `Stopped after ${String(MAX_STEPS)} steps` });
  return messages;
}

function runTool(name: string, args: Obj, data: AppData, emit: (item: ChatItem) => void): string {
  switch (name) {
    case "get_history": return getHistory(data, args);
    case "get_records": return getRecords(data);
    case "get_readiness": return getReadiness();
    case "list_workouts": return listWorkouts();
    case "propose_program": return proposeProgram(data, args, emit);
    case "recommend_workout": return recommend(args, emit);
    default: return JSON.stringify({ ok: false, problem: `no tool "${name}"` });
  }
}

/** What each tool is doing, as a status label. */
export const TOOL_LABEL: Record<string, string> = {
  get_history: "Reading the Saga",
  get_records: "Reading records",
  get_readiness: "Reading the watch",
  list_workouts: "Reading the library",
  propose_program: "Checking program",
  recommend_workout: "Picking",
};

/* ------------------------------ The live chat ------------------------------ */
// Module state, not component state: a turn keeps running when the owner
// switches tabs, and its answer is waiting when they come back.

export interface ChatState extends Chat {
  /** Set while a turn runs: what Mímir is doing, as a label. */
  busy: string | null;
  /** The last turn failed: the reason, and the message to send again. */
  failure: { text: string; message: string } | null;
}

let live: ChatState = { ...(typeof localStorage === "undefined" ? { items: [], messages: [] } : loadChat()), busy: null, failure: null };
const chatListeners = new Set<() => void>();
let abort: AbortController | null = null;

function setLive(patch: Partial<ChatState>): void {
  live = { ...live, ...patch };
  saveChat({ items: live.items, messages: live.messages });
  for (const l of chatListeners) l();
}

export function subscribeChat(l: () => void): () => void {
  chatListeners.add(l);
  return () => { chatListeners.delete(l); };
}

export function chatSnapshot(): ChatState {
  return live;
}

/** Send the owner's message. Failures land in `failure`, in red, with Retry. */
export async function send(settings: MimirSettings, data: AppData, text: string, retry = false): Promise<void> {
  if (live.busy !== null || !text.trim()) return;
  abort = new AbortController();
  const items = retry ? live.items : [...live.items, { kind: "user" as const, text: text.trim() }];
  setLive({ items, busy: "Thinking", failure: null });
  try {
    const messages = await runTurn(
      settings,
      data,
      live.messages,
      text.trim(),
      (item) => { setLive({ items: [...live.items, item] }); },
      (tool) => { setLive({ busy: TOOL_LABEL[tool] ?? "Thinking" }); },
      abort.signal,
    );
    setLive({ messages, busy: null });
  } catch (e) {
    const stopped = abort.signal.aborted;
    setLive({ busy: null, failure: stopped ? null : { text: errorText(e), message: text.trim() } });
  } finally {
    abort = null;
  }
}

export function stop(): void {
  abort?.abort();
}

export function markSaved(index: number): void {
  setLive({ items: live.items.map((it, i) => (i === index && it.kind === "program" ? { ...it, saved: true } : it)) });
}

export function clearChat(): void {
  if (live.busy !== null) return;
  setLive({ items: [], messages: [], failure: null });
}
