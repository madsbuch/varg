/**
 * Strict reading of untyped data: what the Rust store sends back, what the
 * model writes, what the network answers. Every value is checked against
 * the type it claims to be; nothing is coerced ("5" is not 5, 5.5 is not a
 * whole number), nothing is asserted with `as`, and every refusal names
 * the path to the bad value.
 *
 * A Reader collects problems instead of throwing at the first one, so a
 * whole object's mistakes come back at once (the model fixes them in one
 * go). A value read from a bad field is a placeholder, never used: callers
 * check `ok()` before building anything from it.
 */
import type {
  ChatItem,
  ChatMessage,
  EmomPlan,
  EmomStation,
  EmomWarmup,
  FlowPlan,
  FlowStep,
  ForTimePlan,
  ForTimeStage,
  Intensity,
  IntervalPlan,
  Level,
  MusicProfile,
  RidePlan,
  RideSegment,
  Template,
  ToolCall,
} from "../types";
import { GEAR } from "./gear";
import type { GearId } from "./gear";

/** An object's own fields, readable by name. */
export type Fields = ReadonlyMap<string, unknown>;

/** A runtime check, so the narrowing it gives is earned. */
function isGearId(k: string): k is GearId {
  return Object.prototype.hasOwnProperty.call(GEAR, k);
}

const GEAR_IDS: readonly GearId[] = Object.keys(GEAR).filter(isGearId);

/** Parse JSON into `unknown`: the only door from text into a value. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "not JSON" };
  }
}

/**
 * A value inside nested objects, or undefined wherever the path stops being
 * an object. For answers whose every field is optional (Garmin's): what is
 * there is then checked with typeof, never assumed.
 */
export function at(v: unknown, ...path: string[]): unknown {
  let cur = v;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    const fields: [string, unknown][] = Object.entries(cur);
    cur = new Map(fields).get(key);
  }
  return cur;
}

/** A finite number, or undefined. */
export function numberOr(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A string, or undefined. */
export function stringOr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export class Reader {
  readonly problems: string[] = [];

  ok(): boolean {
    return this.problems.length === 0;
  }

  fail(msg: string): void {
    this.problems.push(msg);
  }

  /** A plain object's fields; arrays and null are not objects here. */
  obj(v: unknown, path: string): Fields {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const entries: [string, unknown][] = Object.entries(v);
      return new Map(entries);
    }
    this.fail(`${path} must be an object`);
    return new Map();
  }

  /** Fields of an object that may be absent (undefined or null). */
  optObj(v: unknown, path: string): Fields | undefined {
    return v === undefined || v === null ? undefined : this.obj(v, path);
  }

  arr(v: unknown, path: string): readonly unknown[] {
    if (Array.isArray(v)) {
      const xs: readonly unknown[] = v;
      return xs;
    }
    this.fail(`${path} must be an array`);
    return [];
  }

  str(v: unknown, path: string, max = 10_000): string {
    if (typeof v === "string" && v.trim() !== "" && v.length <= max) return v;
    this.fail(`${path} must be a non-empty string of at most ${max} characters`);
    return "";
  }

  /** A string that may be empty. */
  text(v: unknown, path: string): string {
    if (typeof v === "string") return v;
    this.fail(`${path} must be a string`);
    return "";
  }

  optStr(v: unknown, path: string, max = 10_000): string | undefined {
    return v === undefined || v === null ? undefined : this.str(v, path, max);
  }

  num(v: unknown, path: string): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    this.fail(`${path} must be a number`);
    return 0;
  }

  optNum(v: unknown, path: string): number | undefined {
    return v === undefined || v === null ? undefined : this.num(v, path);
  }

  int(v: unknown, path: string): number {
    if (typeof v === "number" && Number.isInteger(v)) return v;
    this.fail(`${path} must be a whole number`);
    return 0;
  }

  optInt(v: unknown, path: string): number | undefined {
    return v === undefined || v === null ? undefined : this.int(v, path);
  }

  ints(v: unknown, path: string): number[] {
    return this.arr(v, path).map((x, i) => this.int(x, `${path}[${i}]`));
  }

  bool(v: unknown, path: string): boolean {
    if (typeof v === "boolean") return v;
    this.fail(`${path} must be true or false`);
    return false;
  }

  optBool(v: unknown, path: string): boolean | undefined {
    return v === undefined || v === null ? undefined : this.bool(v, path);
  }

  /** One of a fixed set of values, compared exactly. */
  oneOf<T extends string | number>(v: unknown, options: readonly T[], path: string): T {
    const hit = options.find((o) => o === v);
    if (hit !== undefined) return hit;
    this.fail(`${path} must be one of ${options.map((o) => JSON.stringify(o)).join(", ")}`);
    const first = options[0];
    if (first === undefined) throw new Error(`${path}: no options`);
    return first;
  }

  optOneOf<T extends string | number>(v: unknown, options: readonly T[], path: string): T | undefined {
    return v === undefined || v === null ? undefined : this.oneOf(v, options, path);
  }

  strs(v: unknown, path: string): string[] {
    return this.arr(v, path).map((x, i) => this.str(x, `${path}[${i}]`));
  }

  /** An object used as a map: every value read by `read`. */
  record<T>(v: unknown, path: string, read: (v: unknown, path: string) => T): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [k, x] of this.obj(v, path)) out[k] = read(x, `${path}.${k}`);
    return out;
  }

  pair(v: unknown, path: string): [number, number] {
    const xs = this.arr(v, path);
    if (xs.length !== 2) {
      this.fail(`${path} must be [low, high]`);
      return [0, 0];
    }
    return [this.num(xs[0], `${path}[0]`), this.num(xs[1], `${path}[1]`)];
  }
}

/* ------------------------------- Templates ------------------------------- */

export const LEVELS: readonly Level[] = ["beginner", "intermediate", "advanced"];
export const INTENSITIES: readonly Intensity[] = [1, 2, 3];
export const SET_IDS: readonly NonNullable<MusicProfile["set"]>[] = ["techno", "jazz-house", "anthems"];
const PER_SIDE: readonly NonNullable<EmomStation["perSide"]>[] = ["leg", "arm"];
const SIDES: readonly NonNullable<FlowStep["side"]>[] = ["left", "right"];
const FUNCTION: readonly ToolCall["type"][] = ["function"];
const ROLES: readonly ChatMessage["role"][] = ["system", "user", "assistant", "tool"];
const KINDS: readonly ChatItem["kind"][] = ["user", "mimir", "error", "program", "pick"];

export function readInterval(r: Reader, f: Fields, path: string): IntervalPlan {
  return {
    work: r.int(f.get("work"), `${path}.work`),
    rest: r.int(f.get("rest"), `${path}.rest`),
    rounds: r.int(f.get("rounds"), `${path}.rounds`),
  };
}

export function readEmomStation(r: Reader, v: unknown, path: string): EmomStation {
  const f = r.obj(v, path);
  const st: EmomStation = { exerciseId: r.str(f.get("exerciseId"), `${path}.exerciseId`, 100) };
  const reps = f.get("reps");
  const seconds = f.get("seconds");
  if (reps !== undefined && reps !== null) st.reps = r.ints(reps, `${path}.reps`);
  if (seconds !== undefined && seconds !== null) st.seconds = r.ints(seconds, `${path}.seconds`);
  const perSide = r.optOneOf(f.get("perSide"), PER_SIDE, `${path}.perSide`);
  if (perSide !== undefined) st.perSide = perSide;
  const focus = r.optStr(f.get("focus"), `${path}.focus`, 120);
  if (focus !== undefined) st.focus = focus;
  return st;
}

export function readEmomWarmup(r: Reader, v: unknown, path: string): EmomWarmup {
  const f = r.obj(v, path);
  return { exerciseId: r.str(f.get("exerciseId"), `${path}.exerciseId`, 100), seconds: r.int(f.get("seconds"), `${path}.seconds`) };
}

export function readEmom(r: Reader, f: Fields, path: string, defaultMinute?: number): EmomPlan {
  const minute = f.get("minute");
  const plan: EmomPlan = {
    minute: (minute === undefined || minute === null) && defaultMinute !== undefined ? defaultMinute : r.int(minute, `${path}.minute`),
    rounds: r.int(f.get("rounds"), `${path}.rounds`),
    stations: r.arr(f.get("stations"), `${path}.stations`).map((x, i) => readEmomStation(r, x, `${path}.stations[${i}]`)),
  };
  const warmup = f.get("warmup");
  if (warmup !== undefined && warmup !== null) {
    const ws = r.arr(warmup, `${path}.warmup`).map((x, i) => readEmomWarmup(r, x, `${path}.warmup[${i}]`));
    if (ws.length > 0) plan.warmup = ws;
  }
  return plan;
}

export function readFlowStep(r: Reader, v: unknown, path: string): FlowStep {
  const f = r.obj(v, path);
  const st: FlowStep = { exerciseId: r.str(f.get("exerciseId"), `${path}.exerciseId`, 100), seconds: r.int(f.get("seconds"), `${path}.seconds`) };
  const side = r.optOneOf(f.get("side"), SIDES, `${path}.side`);
  if (side !== undefined) st.side = side;
  return st;
}

export function readFlow(r: Reader, f: Fields, path: string): FlowPlan {
  return {
    steps: r.arr(f.get("steps"), `${path}.steps`).map((x, i) => readFlowStep(r, x, `${path}.steps[${i}]`)),
    transition: r.int(f.get("transition"), `${path}.transition`),
  };
}

export function readStage(r: Reader, v: unknown, path: string): ForTimeStage {
  const f = r.obj(v, path);
  const st: ForTimeStage = {
    exerciseId: r.str(f.get("exerciseId"), `${path}.exerciseId`, 100),
    label: r.str(f.get("label"), `${path}.label`, 80),
  };
  const reps = r.optInt(f.get("reps"), `${path}.reps`);
  const meters = r.optInt(f.get("meters"), `${path}.meters`);
  if (reps !== undefined) st.reps = reps;
  if (meters !== undefined) st.meters = meters;
  return st;
}

export function readForTime(r: Reader, f: Fields, path: string): ForTimePlan {
  return { stages: r.arr(f.get("stages"), `${path}.stages`).map((x, i) => readStage(r, x, `${path}.stages[${i}]`)) };
}

export function readSegment(r: Reader, v: unknown, path: string): RideSegment {
  const f = r.obj(v, path);
  const sg: RideSegment = { label: r.str(f.get("label"), `${path}.label`, 40), ftp: r.pair(f.get("ftp"), `${path}.ftp`) };
  const seconds = r.optInt(f.get("seconds"), `${path}.seconds`);
  const kcal = r.optInt(f.get("kcal"), `${path}.kcal`);
  const hrZone = r.optInt(f.get("hrZone"), `${path}.hrZone`);
  const intensity = r.optOneOf(f.get("intensity"), INTENSITIES, `${path}.intensity`);
  const cadence = f.get("cadence");
  if (seconds !== undefined) sg.seconds = seconds;
  if (kcal !== undefined) sg.kcal = kcal;
  if (hrZone !== undefined) sg.hrZone = hrZone;
  if (intensity !== undefined) sg.intensity = intensity;
  if (cadence !== undefined && cadence !== null) sg.cadence = r.pair(cadence, `${path}.cadence`);
  return sg;
}

export function readRide(r: Reader, f: Fields, path: string): RidePlan {
  const plan: RidePlan = { segments: r.arr(f.get("segments"), `${path}.segments`).map((x, i) => readSegment(r, x, `${path}.segments[${i}]`)) };
  const race = r.optBool(f.get("race"), `${path}.race`);
  const free = r.optBool(f.get("free"), `${path}.free`);
  if (race !== undefined) plan.race = race;
  if (free !== undefined) plan.free = free;
  return plan;
}

export function readGear(r: Reader, f: Fields, path: string): NonNullable<Template["gear"]> {
  const gear: NonNullable<Template["gear"]> = {};
  const extra = f.get("extra");
  if (extra !== undefined && extra !== null) {
    const ids = r.arr(extra, `${path}.extra`).map((x, i) => r.oneOf(x, GEAR_IDS, `${path}.extra[${i}]`));
    if (ids.length > 0) gear.extra = ids;
  }
  const detail = r.optObj(f.get("detail"), `${path}.detail`);
  if (detail) {
    const out: Partial<Record<GearId, string>> = {};
    for (const [k, v] of detail) {
      const id = r.oneOf(k, GEAR_IDS, `${path}.detail key`);
      out[id] = r.str(v, `${path}.detail.${k}`, 60);
    }
    if (Object.keys(out).length > 0) gear.detail = out;
  }
  return gear;
}

export function readMusic(r: Reader, f: Fields, path: string): MusicProfile {
  const m: MusicProfile = {
    bpm: r.int(f.get("bpm"), `${path}.bpm`),
    style: r.text(f.get("style"), `${path}.style`),
    theme: r.text(f.get("theme"), `${path}.theme`),
  };
  const set = r.optOneOf(f.get("set"), SET_IDS, `${path}.set`);
  const energy = r.optOneOf(f.get("energy"), INTENSITIES, `${path}.energy`);
  if (set !== undefined) m.set = set;
  if (energy !== undefined) m.energy = energy;
  return m;
}

/** A whole stored Template, exactly as the app wrote it. */
export function readTemplate(r: Reader, v: unknown, path: string): Template {
  const f = r.obj(v, path);
  const t: Template = {
    id: r.str(f.get("id"), `${path}.id`, 120),
    name: r.str(f.get("name"), `${path}.name`, 120),
    branch: r.str(f.get("branch"), `${path}.branch`, 60),
    description: r.str(f.get("description"), `${path}.description`),
    scheme: r.str(f.get("scheme"), `${path}.scheme`),
    level: r.oneOf(f.get("level"), LEVELS, `${path}.level`),
    exerciseIds: r.strs(f.get("exerciseIds"), `${path}.exerciseIds`),
    music: readMusic(r, r.obj(f.get("music"), `${path}.music`), `${path}.music`),
  };
  const estimate = r.optInt(f.get("estimateMinutes"), `${path}.estimateMinutes`);
  if (estimate !== undefined) t.estimateMinutes = estimate;
  const interval = r.optObj(f.get("interval"), `${path}.interval`);
  if (interval) t.interval = readInterval(r, interval, `${path}.interval`);
  const forTime = r.optObj(f.get("forTime"), `${path}.forTime`);
  if (forTime) t.forTime = readForTime(r, forTime, `${path}.forTime`);
  const flow = r.optObj(f.get("flow"), `${path}.flow`);
  if (flow) t.flow = readFlow(r, flow, `${path}.flow`);
  const emom = r.optObj(f.get("emom"), `${path}.emom`);
  if (emom) t.emom = readEmom(r, emom, `${path}.emom`);
  const ride = r.optObj(f.get("ride"), `${path}.ride`);
  if (ride) t.ride = readRide(r, ride, `${path}.ride`);
  const gear = r.optObj(f.get("gear"), `${path}.gear`);
  if (gear) t.gear = readGear(r, gear, `${path}.gear`);
  return t;
}

/* --------------------------------- Chat ---------------------------------- */

export function readToolCall(r: Reader, v: unknown, path: string): ToolCall {
  const f = r.obj(v, path);
  r.oneOf(f.get("type"), FUNCTION, `${path}.type`);
  const fn = r.obj(f.get("function"), `${path}.function`);
  return {
    id: r.str(f.get("id"), `${path}.id`, 200),
    type: "function",
    function: { name: r.str(fn.get("name"), `${path}.function.name`, 100), arguments: r.text(fn.get("arguments"), `${path}.function.arguments`) },
  };
}

export function readChatMessage(r: Reader, v: unknown, path: string): ChatMessage {
  const f = r.obj(v, path);
  const role = r.oneOf(f.get("role"), ROLES, `${path}.role`);
  switch (role) {
    case "system":
    case "user":
      return { role, content: r.text(f.get("content"), `${path}.content`) };
    case "tool":
      return { role, tool_call_id: r.str(f.get("tool_call_id"), `${path}.tool_call_id`, 200), content: r.text(f.get("content"), `${path}.content`) };
    case "assistant": {
      const content = f.get("content");
      const calls = f.get("tool_calls");
      const msg: ChatMessage = {
        role,
        content: content === null || content === undefined ? null : r.text(content, `${path}.content`),
      };
      if (calls !== undefined && calls !== null) {
        const tc = r.arr(calls, `${path}.tool_calls`).map((x, i) => readToolCall(r, x, `${path}.tool_calls[${i}]`));
        if (tc.length > 0) msg.tool_calls = tc;
      }
      return msg;
    }
  }
}

export function readChatItem(r: Reader, v: unknown, path: string): ChatItem {
  const f = r.obj(v, path);
  const kind = r.oneOf(f.get("kind"), KINDS, `${path}.kind`);
  switch (kind) {
    case "user":
    case "mimir":
    case "error":
      return { kind, text: r.text(f.get("text"), `${path}.text`) };
    case "pick":
      return { kind, templateId: r.str(f.get("templateId"), `${path}.templateId`, 120), why: r.text(f.get("why"), `${path}.why`) };
    case "program": {
      const item: ChatItem = { kind, template: readTemplate(r, f.get("template"), `${path}.template`) };
      const replaces = r.optStr(f.get("replaces"), `${path}.replaces`, 120);
      const saved = r.optBool(f.get("saved"), `${path}.saved`);
      if (replaces !== undefined) item.replaces = replaces;
      if (saved !== undefined) item.saved = saved;
      return item;
    }
  }
}
