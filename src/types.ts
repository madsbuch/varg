// Core domain types for Varg.
// Weights are always kilograms, distances always meters — kg or death.

/**
 * How an exercise is measured. This drives which inputs a set shows.
 * - weight_reps: barbell/dumbbell work (weight + reps)
 * - reps: bodyweight reps (pull-ups, push-ups)
 * - time: for-time or holds (planks, runs measured by time)
 * - distance_time: rucks / runs (distance + time)
 */
export type Metric = "weight_reps" | "reps" | "time" | "distance_time";

export type Category =
  | "strength"
  | "bodyweight"
  | "cardio"
  | "ruck"
  | "core"
  | "conditioning";

export interface Exercise {
  id: string;
  name: string;
  category: Category;
  metric: Metric;
  muscles: string[];
  builtIn: boolean;
}

/** A single logged set inside a session entry. */
export interface WorkoutSet {
  id: string;
  weight?: number; // kg
  reps?: number;
  seconds?: number;
  meters?: number;
  rpe?: number; // rate of perceived exertion 1-10
  done: boolean;
}

export interface SessionEntry {
  id: string;
  exerciseId: string;
  sets: WorkoutSet[];
  note?: string;
}

export interface Session {
  id: string;
  name: string;
  date: string; // ISO timestamp of start
  finishedAt?: string; // ISO timestamp when completed
  splitId?: string;
  splitDayId?: string;
  templateId?: string;
  entries: SessionEntry[];
  note?: string;
}

/** A day within a training split. */
export interface SplitDay {
  id: string;
  name: string;
  exerciseIds: string[];
}

export interface Split {
  id: string;
  name: string;
  description?: string;
  days: SplitDay[];
  builtIn: boolean;
}

export type PRKind =
  | "1rm" // best estimated one-rep max (weight_reps)
  | "weight" // heaviest weight for reps
  | "reps" // most reps in a set
  | "time" // fastest time (lower is better)
  | "distance"; // longest distance

/** A personal record for an exercise. Auto-detected from sessions or entered manually. */
export interface PersonalRecord {
  id: string;
  exerciseId: string;
  kind: PRKind;
  value: number; // canonical unit (kg, reps, seconds, meters)
  reps?: number; // context for weight/1rm PRs
  date: string; // ISO
  sessionId?: string; // set when auto-detected
  note?: string;
  manual: boolean;
}

/** What a generated workout track should sound like. */
export interface MusicProfile {
  bpm: number;
  style: string; // genre / instrumentation tags
  theme: string; // mood and story of the workout
}

/** A military-style workout template — a prescribed session. */
export interface Template {
  id: string;
  name: string;
  branch: string; // "Army", "USMC", "CrossFit Hero", etc.
  description: string;
  scheme: string; // human-readable prescription
  exerciseIds: string[];
  music: MusicProfile;
}

export interface AppData {
  version: number;
  exercises: Exercise[];
  splits: Split[];
  sessions: Session[];
  prs: PersonalRecord[];
}
