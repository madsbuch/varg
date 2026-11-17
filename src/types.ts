// Core domain types for Varg. Weights are always kilograms, distances
// always metres — kg or death.
//
// The data types are derived from the zod schemas in lib/schema.ts, where
// each field is documented: one definition, so a type and the check that
// guards it at runtime cannot drift apart.
import type { z } from "zod";
import type {
  CategorySchema,
  ChatItemSchema,
  ChatMessageSchema,
  EmomStationSchema,
  EmomWarmupSchema,
  ExerciseSchema,
  FlowStepSchema,
  ForTimeStageSchema,
  HeartRateSchema,
  IntensitySchema,
  LevelSchema,
  MetricSchema,
  MusicProfileSchema,
  PersonalRecordSchema,
  PlanSchema,
  PRKindSchema,
  RideSegmentSchema,
  SavedProgramSchema,
  SessionEntrySchema,
  SessionSchema,
  SideSchema,
  TemplateGearSchema,
  TemplateSchema,
  ToolCallSchema,
  WorkoutSetSchema,
} from "./lib/schema";

/**
 * How an exercise is measured; this drives which inputs a set shows.
 * weight_reps (barbell), reps (bodyweight), time (holds), distance_time
 * (rucks, runs).
 */
export type Metric = z.infer<typeof MetricSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type WorkoutSet = z.infer<typeof WorkoutSetSchema>;
export type SessionEntry = z.infer<typeof SessionEntrySchema>;
export type Session = z.infer<typeof SessionSchema>;
export type HeartRate = z.infer<typeof HeartRateSchema>;
export type PRKind = z.infer<typeof PRKindSchema>;
export type PersonalRecord = z.infer<typeof PersonalRecordSchema>;

/** Which way a record improves: a bigger number, or a smaller one. */
export type PRDirection = "higher" | "lower";

/**
 * The direction each PR kind improves in, declared exactly once and honoured
 * by every comparison in `lib/prs.ts`.
 *
 * `time` is a *hold*: every time-metric exercise in the app is a plank, a wall
 * sit or a dead hang, so longer wins. A for-time effort (a scored 400 m run)
 * is the opposite and must NOT reuse this kind — it would store the athlete's
 * worst attempt as the record. Give it a new kind here with direction "lower"
 * and map the metric to it in `prKindsFor`; the exhaustive Record and the
 * exhaustive switch make both halves compile errors if you forget.
 */
export const PR_DIRECTION: Record<PRKind, PRDirection> = {
  "1rm": "higher",
  weight: "higher",
  reps: "higher",
  time: "higher",
  distance: "higher",
};

/* -------------------------------- Templates ------------------------------- */

export type Level = z.infer<typeof LevelSchema>;
/** Music intensity: 1 low, 2 mid, 3 peak. */
export type Intensity = z.infer<typeof IntensitySchema>;
export type Side = z.infer<typeof SideSchema>;
export type MusicProfile = z.infer<typeof MusicProfileSchema>;
export type TemplateGear = z.infer<typeof TemplateGearSchema>;
export type EmomStation = z.infer<typeof EmomStationSchema>;
export type EmomWarmup = z.infer<typeof EmomWarmupSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type ForTimeStage = z.infer<typeof ForTimeStageSchema>;
export type RideSegment = z.infer<typeof RideSegmentSchema>;

/** How a workout runs: exactly one kind, which picks the player. */
export type Plan = z.infer<typeof PlanSchema>;
export type PlanKind = Plan["kind"];
export type IntervalPlan = Extract<Plan, { kind: "interval" }>;
export type EmomPlan = Extract<Plan, { kind: "emom" }>;
export type FlowPlan = Extract<Plan, { kind: "flow" }>;
export type ForTimePlan = Extract<Plan, { kind: "forTime" }>;
export type RidePlan = Extract<Plan, { kind: "ride" }>;
export type LoggedPlan = Extract<Plan, { kind: "logged" }>;

/** A workout: a built-in (seed.ts) or one Mímir wrote. */
export type Template = z.infer<typeof TemplateSchema>;

/* ---------------------------------- Mímir --------------------------------- */

/** A program the owner saved from Mímir. Its id is the template's (`mimir-…`). */
export type SavedProgram = z.infer<typeof SavedProgramSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
/** The API history, as OpenRouter's chat completions take it. */
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
/** What the owner sees in the chat. */
export type ChatItem = z.infer<typeof ChatItemSchema>;

/** A stored chat row: its id, its place in the order, and what it holds. */
export interface ChatEntry<T> {
  id: string;
  seq: number;
  body: T;
}

export interface MimirChat {
  items: ChatEntry<ChatItem>[];
  messages: ChatEntry<ChatMessage>[];
}

/** Everything the app holds in memory; written through to the store. */
export interface AppData {
  version: number;
  exercises: Exercise[];
  sessions: Session[];
  prs: PersonalRecord[];
  /** Programs Mímir wrote with the owner (lib/programs.ts). */
  programs: SavedProgram[];
  /** The conversation with Mímir. */
  mimir: MimirChat;
}
