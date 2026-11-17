/**
 * Every shape Varg stores or sends, as a zod schema: the single source of
 * the app's data types (src/types.ts derives them from here) and of their
 * checks. JSON never enters the app untyped: whatever comes from the Rust
 * store, a setting, the network or the model is parsed with one of these
 * (`parseAs`) before any of it is used.
 *
 * Stored shapes are strict objects: an unknown field is an error, never
 * dropped quietly. Nothing coerces: "5" is not 5, 5.5 is not a whole number.
 *
 * The Rust store has the same shapes as serde types
 * (src-tauri/store/src/model.rs, deny_unknown_fields). The two are held
 * together by fixtures both test suites read: scripts/store.test.ts writes
 * what the app sends and every enum's values; the Rust tests decode them.
 */
import { z } from "zod";

/* --------------------------------- Enums --------------------------------- */

export const MetricSchema = z.enum(["weight_reps", "reps", "time", "distance_time"]);
export const CategorySchema = z.enum(["strength", "bodyweight", "cardio", "ruck", "core", "conditioning"]);
export const PRKindSchema = z.enum(["1rm", "weight", "reps", "time", "distance"]);
export const LevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const IntensitySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const SideSchema = z.enum(["left", "right"]);
export const PerSideSchema = z.enum(["leg", "arm"]);
export const SetIdSchema = z.enum(["techno", "jazz-house", "anthems"]);
/** The kit, in the order a card lists it (labels in lib/gear.ts). */
export const GearIdSchema = z.enum([
  "spinBike", "airBike", "rower", "chestStrap", "barbell", "rack", "bench", "kettlebell",
  "carryPair", "sled", "wallBall", "medBall", "pullUpBar", "rings", "dipBars", "band",
  "bandOrPack", "box", "jumpRope", "ruck", "vest", "mat",
]);

const id = z.string().min(1);
const text = z.string();
const label = z.string().min(1);

/* ----------------------------- Training data ----------------------------- */

export const ExerciseSchema = z.strictObject({
  id,
  name: label,
  category: CategorySchema,
  metric: MetricSchema,
  muscles: z.array(text),
  builtIn: z.boolean(),
  /**
   * Superseded by a corrected built-in with a different id: kept so old
   * sessions and PRs resolve, never offered. Set by mergeBuiltIns on load,
   * never stored in the database (the browser backend's blob keeps it).
   */
  deprecated: z.boolean().optional(),
});

/** A single logged set. Weights in kg, distances in metres. */
export const WorkoutSetSchema = z.strictObject({
  id,
  weight: z.number().optional(),
  reps: z.int().optional(),
  seconds: z.number().optional(),
  meters: z.number().optional(),
  /** Rate of perceived exertion, 1-10. */
  rpe: z.number().optional(),
  done: z.boolean(),
});

export const SessionEntrySchema = z.strictObject({
  id,
  exerciseId: id,
  sets: z.array(WorkoutSetSchema),
  note: text.optional(),
});

/** A session's heart rate, from the strap (see lib/hr.ts). */
export const HeartRateSchema = z.strictObject({
  /** bpm, time-weighted. */
  avg: z.number(),
  max: z.number(),
  /** Seconds per trace value. */
  every: z.number(),
  /** Average bpm per `every` seconds from the start; 0 = no reading. */
  trace: z.array(z.number()),
});

export const SessionSchema = z.strictObject({
  id,
  name: text,
  /** ISO timestamp of the start. */
  date: id,
  finishedAt: text.optional(),
  templateId: text.optional(),
  entries: z.array(SessionEntrySchema),
  note: text.optional(),
  heartRate: HeartRateSchema.optional(),
});

/** A personal record. Auto-detected from sessions or entered by hand. */
export const PersonalRecordSchema = z.strictObject({
  id,
  exerciseId: id,
  kind: PRKindSchema,
  /** Canonical unit: kg, reps, seconds, metres. */
  value: z.number(),
  reps: z.int().optional(),
  date: id,
  sessionId: text.optional(),
  note: text.optional(),
  manual: z.boolean(),
});

/* -------------------------------- Templates ------------------------------- */

/** What a workout's music should sound like. */
export const MusicProfileSchema = z.strictObject({
  bpm: z.int(),
  /** Genre and instrumentation tags. */
  style: text,
  /** Mood and story of the workout. */
  theme: text,
  /** Adaptive rides: the song set played unless the owner picks another. */
  set: SetIdSchema.optional(),
  /**
   * Played on a song set: the intensity of the main part. Warm-ups and
   * yoga play Low; default Peak (workout-music.ts).
   */
  energy: IntensitySchema.optional(),
});

/** Kit beyond what the exercises declare (`extra`) and its specifics (`detail`). */
export const TemplateGearSchema = z.strictObject({
  extra: z.array(GearIdSchema).optional(),
  detail: z.partialRecord(GearIdSchema, label).optional(),
});

/**
 * One EMOM station: it owns one whole minute. Exactly one of `reps` or
 * `seconds`, ONE NUMBER PER ROUND, never a range (template-check.ts).
 */
export const EmomStationSchema = z.strictObject({
  exerciseId: id,
  reps: z.array(z.int()).optional(),
  seconds: z.array(z.int()).optional(),
  /** Reps split over two sides: "16 reps · 8 per leg". */
  perSide: PerSideSchema.optional(),
  /** What the station trains, for the details sheet. */
  focus: text.optional(),
});

/** One timed warm-up exercise, run back to back before the first minute. */
export const EmomWarmupSchema = z.strictObject({ exerciseId: id, seconds: z.int() });

/** One timed pose. One-sided poses come as a left step then a right step. */
export const FlowStepSchema = z.strictObject({ exerciseId: id, seconds: z.int(), side: SideSchema.optional() });

/** One leg of a for-time workout; its label states what it logs ("100 pull-ups"). */
export const ForTimeStageSchema = z.strictObject({
  exerciseId: id,
  label,
  reps: z.int().optional(),
  meters: z.int().optional(),
});

/** One block of a ride: ends on `seconds` or `kcal`, exactly one. */
export const RideSegmentSchema = z.strictObject({
  label,
  /** Target power, % of FTP, low to high. */
  ftp: z.tuple([z.number(), z.number()]),
  seconds: z.int().optional(),
  kcal: z.int().optional(),
  /** Target cadence, rpm, low to high. */
  cadence: z.tuple([z.number(), z.number()]).optional(),
  /** Steer by this heart-rate zone (1-5) instead of watts. */
  hrZone: z.int().optional(),
  /** How hard the music drives in this block (adaptive rides). */
  intensity: IntensitySchema.optional(),
});

/**
 * How a workout runs: exactly one kind, which picks the player. The
 * exercises it uses are the ones its plan names (`planExerciseIds`), and
 * the guided kinds' scheme is computed from their numbers (`schemeOf`):
 * nothing is stored twice.
 */
export const PlanSchema = z.discriminatedUnion("kind", [
  /** A guided circuit: every station timed, the same work and rest. */
  z.strictObject({
    kind: z.literal("interval"),
    stations: z.array(id),
    work: z.int(),
    rest: z.int(),
    rounds: z.int(),
    /** Appended to the computed scheme: "90 s a round". */
    note: label.optional(),
  }),
  /** Every minute on the minute, an optional warm-up first. */
  z.strictObject({
    kind: z.literal("emom"),
    /** Seconds each station owns; 60 for a true EMOM. */
    minute: z.int(),
    rounds: z.int(),
    stations: z.array(EmomStationSchema),
    warmup: z.array(EmomWarmupSchema).optional(),
    note: label.optional(),
  }),
  /** Yoga: every pose its own hold, a transition to move between them. */
  z.strictObject({
    kind: z.literal("flow"),
    steps: z.array(FlowStepSchema),
    /** Seconds to move into the next pose; the lead-in is the same. */
    transition: z.int(),
    note: label.optional(),
  }),
  /** A fixed amount of work against the stopwatch, one Done per stage. */
  z.strictObject({
    kind: z.literal("forTime"),
    stages: z.array(ForTimeStageSchema),
    scheme: label,
    /** Typical finishing time, for the library's length filter. */
    estimateMinutes: z.int(),
  }),
  /** The indoor bike, run against live bike data. */
  z.strictObject({
    kind: z.literal("ride"),
    segments: z.array(RideSegmentSchema),
    /** Scored by total time (any kcal block makes it one). */
    race: z.boolean().optional(),
    /** The bike console: no segments, no end. */
    free: z.boolean().optional(),
    scheme: label,
    /** Only when the length is not computable (kcal blocks, free ride). */
    estimateMinutes: z.int().optional(),
  }),
  /** Sets logged by hand: strength work. */
  z.strictObject({
    kind: z.literal("logged"),
    exercises: z.array(id),
    scheme: label,
    estimateMinutes: z.int(),
  }),
]);

/** A workout: a built-in (seed.ts) or one Mímir wrote. */
export const TemplateSchema = z.strictObject({
  id,
  name: label,
  /** The badge: "CrossFit Hero", "Mímir". */
  branch: label,
  description: text,
  level: LevelSchema,
  plan: PlanSchema,
  music: MusicProfileSchema,
  gear: TemplateGearSchema.optional(),
});

/* --------------------------------- Mímir ---------------------------------- */

export const SavedProgramSchema = z.strictObject({ id, template: TemplateSchema, savedAt: id });

export const ToolCallSchema = z.strictObject({
  id,
  type: z.literal("function"),
  function: z.strictObject({ name: id, arguments: text }),
});

/** The model's history, as OpenRouter's chat completions take it. */
export const ChatMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("system"), content: text }),
  z.strictObject({ role: z.literal("user"), content: text }),
  z.strictObject({
    role: z.literal("assistant"),
    content: text.nullable(),
    tool_calls: z.array(ToolCallSchema).optional(),
  }),
  z.strictObject({ role: z.literal("tool"), tool_call_id: id, content: text }),
]);

/** What the owner sees in the chat. */
export const ChatItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user"), text }),
  z.strictObject({ kind: z.literal("mimir"), text }),
  z.strictObject({ kind: z.literal("error"), text }),
  z.strictObject({ kind: z.literal("pick"), templateId: id, why: text }),
  z.strictObject({
    kind: z.literal("program"),
    template: TemplateSchema,
    replaces: id.optional(),
    saved: z.boolean().optional(),
  }),
]);

/** A stored chat row: its id, its place in the order, what it holds. */
export function chatEntrySchema<T extends z.ZodType>(body: T) {
  return z.strictObject({ id, seq: z.int(), body });
}
export const ChatItemEntrySchema = chatEntrySchema(ChatItemSchema);
export const ChatMessageEntrySchema = chatEntrySchema(ChatMessageSchema);

/* ------------------------------ The database ------------------------------ */

/**
 * Everything the Rust store sends at launch (`store_load`). Rows it could
 * not read arrive as `problems`; the app shows them in red.
 */
export const SnapshotSchema = z.strictObject({
  exercises: z.array(z.unknown()),
  sessions: z.array(z.unknown()),
  prs: z.array(z.unknown()),
  programs: z.array(z.unknown()),
  mimirItems: z.array(z.unknown()),
  mimirMessages: z.array(z.unknown()),
  problems: z.array(text),
});

/** One setting row, as `kv_all` sends it. */
export const KvRowSchema = z.tuple([text, text]);

/** A cached audio file's description (its bytes travel as base64 alongside). */
export const BlobInfoSchema = z.strictObject({ key: id, title: text, mime: text, createdAt: text });

/* ------------------------------- Reading ---------------------------------- */

export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** "plan.stations[2]: expected string" — a path a person (or the model) can act on. */
export function describeIssues(error: z.ZodError, root: string): string[] {
  return error.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
    return `${root}${path}: ${i.message}`;
  });
}

/** Parse `value` as `schema`: the typed value, or every problem with its path. */
export function parseAs<S extends z.ZodType>(schema: S, value: unknown, root = "value"): Parsed<z.infer<S>> {
  const r = schema.safeParse(value);
  return r.success ? { ok: true, value: r.data } : { ok: false, problems: describeIssues(r.error, root) };
}

/** Text into a value, then the value into its type. The only door from JSON text into the app. */
export function parseJsonAs<S extends z.ZodType>(schema: S, text: string, root = "value"): Parsed<z.infer<S>> {
  let value: unknown;
  try {
    // The one door from text to a value (eslint.config.js allows it here only): straight into a schema.
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, problems: [`${root}: not JSON (${e instanceof Error ? e.message : "unreadable"})`] };
  }
  return parseAs(schema, value, root);
}

/** Parse, or throw with every problem: for values the app itself wrote, where a mismatch is a bug. */
export function mustParse<S extends z.ZodType>(schema: S, value: unknown, root = "value"): z.infer<S> {
  const r = parseAs(schema, value, root);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.value;
}
