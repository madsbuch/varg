/**
 * Drizzle schema for Varg's on-device SQLite database.
 *
 * Schema changes are tracked as SQL migrations in /drizzle — run
 * `bun run db:generate` after editing this file and commit the output.
 * Migrations are applied on app startup (see src/db/sqlite.ts).
 */
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Single-row-per-key app settings (units, etc.). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const exercises = sqliteTable("exercises", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  metric: text("metric").notNull(),
  /** JSON-encoded string array. */
  muscles: text("muscles").notNull().default("[]"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
});

export const splits = sqliteTable("splits", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
});

export const splitDays = sqliteTable("split_days", {
  id: text("id").primaryKey(),
  splitId: text("split_id")
    .notNull()
    .references(() => splits.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
});

export const splitDayExercises = sqliteTable(
  "split_day_exercises",
  {
    dayId: text("day_id")
      .notNull()
      .references(() => splitDays.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.dayId, t.exerciseId] })],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** ISO timestamp of session start. */
  date: text("date").notNull(),
  finishedAt: text("finished_at"),
  splitId: text("split_id"),
  splitDayId: text("split_day_id"),
  templateId: text("template_id"),
  note: text("note"),
});

export const sessionEntries = sqliteTable("session_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id").notNull(),
  position: integer("position").notNull(),
  note: text("note"),
});

export const workoutSets = sqliteTable("workout_sets", {
  id: text("id").primaryKey(),
  entryId: text("entry_id")
    .notNull()
    .references(() => sessionEntries.id, { onDelete: "cascade" }),
  /** Denormalised for cheap per-session replacement. */
  sessionId: text("session_id").notNull(),
  position: integer("position").notNull(),
  weight: real("weight"),
  reps: integer("reps"),
  seconds: real("seconds"),
  meters: real("meters"),
  rpe: real("rpe"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
});

export const personalRecords = sqliteTable("personal_records", {
  id: text("id").primaryKey(),
  exerciseId: text("exercise_id").notNull(),
  kind: text("kind").notNull(),
  value: real("value").notNull(),
  reps: integer("reps"),
  date: text("date").notNull(),
  sessionId: text("session_id"),
  note: text("note"),
  manual: integer("manual", { mode: "boolean" }).notNull().default(false),
});
