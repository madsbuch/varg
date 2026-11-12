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
  /**
   * Superseded by a corrected built-in with a different id. Kept so old
   * sessions and PRs still resolve, but never offered when picking an
   * exercise. Set by mergeBuiltIns on load, not stored in seed content.
   */
  deprecated?: boolean | undefined;
}

/** A single logged set inside a session entry. */
export interface WorkoutSet {
  id: string;
  weight?: number | undefined; // kg
  reps?: number | undefined;
  seconds?: number | undefined;
  meters?: number | undefined;
  rpe?: number | undefined; // rate of perceived exertion 1-10
  done: boolean;
}

export interface SessionEntry {
  id: string;
  exerciseId: string;
  sets: WorkoutSet[];
  note?: string | undefined;
}

export interface Session {
  id: string;
  name: string;
  date: string; // ISO timestamp of start
  finishedAt?: string | undefined; // ISO timestamp when completed
  templateId?: string | undefined;
  entries: SessionEntry[];
  note?: string | undefined;
  /** From the paired chest strap, when one recorded the session. */
  heartRate?: HeartRate | undefined;
}

/** A session's heart rate, from the strap (see lib/hr.ts). */
export interface HeartRate {
  avg: number; // bpm, time-weighted
  max: number; // bpm
  /** Seconds per trace value. */
  every: number;
  /** Average bpm per `every` seconds from the start; 0 = no reading. */
  trace: number[];
}

export type PRKind =
  | "1rm" // best estimated one-rep max (weight_reps)
  | "weight" // heaviest weight for reps
  | "reps" // most reps in a set
  | "time" // longest hold — see PR_DIRECTION before assuming otherwise
  | "distance"; // longest distance

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

/** A personal record for an exercise. Auto-detected from sessions or entered manually. */
export interface PersonalRecord {
  id: string;
  exerciseId: string;
  kind: PRKind;
  value: number; // canonical unit (kg, reps, seconds, meters)
  reps?: number | undefined; // context for weight/1rm PRs
  date: string; // ISO
  sessionId?: string | undefined; // set when auto-detected
  note?: string | undefined;
  manual: boolean;
}

/** What a generated workout track should sound like. */
export interface MusicProfile {
  bpm: number;
  style: string; // genre / instrumentation tags
  theme: string; // mood and story of the workout
  /**
   * Adaptive rides: the songs (src/lib/songs.ts ids) each intensity draws
   * on. The ride rotates through them block by block, so every round does
   * not replay the same loops.
   */
  mix?: Record<Intensity, string[]> | undefined;
}

/** Interval prescription for circuit templates that run guided. */
export interface IntervalPlan {
  work: number; // seconds per station
  rest: number; // seconds between stations
  rounds: number;
}

/**
 * One leg of a for-time workout: a fixed amount of one exercise, done before
 * moving on. The athlete taps Done when it is finished; the gap between taps
 * is the stage's split.
 */
export interface ForTimeStage {
  exerciseId: string;
  /** What the athlete sees, e.g. "100 pull-ups" or "1.6 km run". */
  label: string;
  /** Prescribed reps — for reps and weight_reps exercises. */
  reps?: number | undefined;
  /** Prescribed distance in metres — for distance_time exercises. */
  meters?: number | undefined;
}

export type Side = "left" | "right";

/** One timed pose in a flow. One-sided poses come as a left/right pair. */
export interface FlowStep {
  exerciseId: string;
  seconds: number;
  side?: Side | undefined;
}

/**
 * A guided sequence where every step has its own length — a yoga class.
 * No rests: the next pose is the transition. Pose names are spoken and form
 * cues shown on screen.
 */
export interface FlowPlan {
  steps: FlowStep[];
  /**
   * Seconds between poses to move into the next one. The voice names the
   * next pose as the transition starts, so the hold that follows is all hold.
   * The lead-in before the first pose is the same length.
   */
  transition: number;
}

/** A fixed amount of work, scored by the time it takes. */
export interface ForTimePlan {
  stages: ForTimeStage[];
}

/**
 * One block of an indoor-bike ride. It ends after `seconds`, or once the
 * rider has burned `kcal` more — exactly one of the two. The target is a
 * share of the rider's FTP, so it follows the FTP set in Settings.
 */
export interface RideSegment {
  /** What the block is, spoken and shown: "Zone 2", "Sweet spot", "Sprint". */
  label: string;
  /** Target power as % of FTP, low to high. */
  ftp: [number, number];
  seconds?: number | undefined;
  kcal?: number | undefined;
  /** Target cadence in rpm, low to high. */
  cadence?: [number, number] | undefined;
  /**
   * Ride by heart rate: the target is this zone (1-5) of the rider's
   * heart-rate zones (Skipan, copied from Garmin Connect), and `ftp` is
   * only the watts to start at. The ride will not start without zones
   * and a paired strap.
   */
  hrZone?: number | undefined;
  /**
   * How hard the battle track drives in this block: 1 held back (muffled),
   * 2 full groove, 3 everything with a build into it. Adaptive rides set it
   * on every block; the player books each change on the audio clock ahead
   * of time. Without it the track plays as recorded.
   */
  intensity?: Intensity | undefined;
}

/** Battle-track intensity of a ride block; see RideSegment.intensity. */
export type Intensity = 1 | 2 | 3;

/** A ride on the indoor bike, run by the ride player against live bike data. */
export interface RidePlan {
  segments: RideSegment[];
  /** Scored by total time (kcal races): best time on the card, like for time. */
  race?: boolean | undefined;
  /**
   * No program: the bike console. No segments, no targets, no end; the
   * clock counts up and the rider finishes when they like.
   */
  free?: boolean | undefined;
}

/** How hard a workout is to start with — the Hunt screen filters on it. */
export type Level = "beginner" | "intermediate" | "advanced";

/** A military-style workout template — a prescribed session. */
export interface Template {
  id: string;
  name: string;
  branch: string; // "Army", "USMC", "CrossFit Hero", etc.
  description: string;
  scheme: string; // human-readable prescription
  level: Level;
  /**
   * Typical finishing time in minutes, for workouts whose length depends on
   * the athlete (for time, logged sessions). Interval and flow workouts
   * leave it out: their clock time is computed exactly.
   */
  estimateMinutes?: number | undefined;
  exerciseIds: string[];
  music: MusicProfile;
  /** When set, starting the template launches the guided interval player. */
  interval?: IntervalPlan | undefined;
  /**
   * When set, starting the template launches the for-time player: a running
   * stopwatch and the stages in order. Never set together with `interval`.
   */
  forTime?: ForTimePlan | undefined;
  /**
   * When set, starting the template launches the guided player with these
   * steps, each its own length. Never set together with interval or forTime.
   */
  flow?: FlowPlan | undefined;
  /**
   * An indoor-bike ride: starting it launches the ride player, which reads
   * power, cadence and kcal from the bike over Bluetooth. Never set
   * together with interval, forTime or flow.
   */
  ride?: RidePlan | undefined;
}

export interface AppData {
  version: number;
  exercises: Exercise[];
  sessions: Session[];
  prs: PersonalRecord[];
}
