/**
 * Smoke test: apply the drizzle-kit migrations in /drizzle to an
 * in-memory SQLite (bun:sqlite), then run representative CRUD through
 * the same Drizzle schema the app uses. Catches broken migrations or
 * schema/query mismatches before they ship.
 *
 * Run with: bun run db:smoke
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as t from "../src/db/schema";
import { seedExercises, seedTemplates } from "../src/lib/seed";
import { hasLibraryEntry } from "../src/lib/library";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);

// Apply migrations exactly like the app does: sorted files, split on
// drizzle's statement-breakpoint markers.
const dir = join(import.meta.dir, "..", "drizzle");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) throw new Error("No migration files found in /drizzle");
for (const f of files) {
  const sql = readFileSync(join(dir, f), "utf8");
  for (const raw of sql.split("--> statement-breakpoint")) {
    const stmt = raw.trim();
    if (stmt) sqlite.run(stmt);
  }
  console.log(`applied ${f}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

// --- exercises ---
db.insert(t.exercises)
  .values({
    id: "ex-1",
    name: "Back Squat",
    category: "strength",
    metric: "weight_reps",
    muscles: JSON.stringify(["quads"]),
    builtIn: true,
  })
  .run();
// upsert path used by saveExercise
db.insert(t.exercises)
  .values({
    id: "ex-1",
    name: "Back Squat (edited)",
    category: "strength",
    metric: "weight_reps",
    muscles: "[]",
    builtIn: true,
  })
  .onConflictDoUpdate({
    target: t.exercises.id,
    set: { name: "Back Squat (edited)" },
  })
  .run();
const exs = db.select().from(t.exercises).all();
assert(exs.length === 1 && exs[0].name === "Back Squat (edited)", "exercise upsert");
assert(exs[0].builtIn === true, "boolean roundtrip");

// --- splits ---
db.insert(t.splits).values({ id: "sp-1", name: "PPL", builtIn: false }).run();
db.insert(t.splitDays)
  .values([
    { id: "d-1", splitId: "sp-1", name: "Push", position: 0 },
    { id: "d-2", splitId: "sp-1", name: "Pull", position: 1 },
  ])
  .run();
db.insert(t.splitDayExercises)
  .values([{ dayId: "d-1", exerciseId: "ex-1", position: 0 }])
  .run();

// --- session + entries + sets ---
db.insert(t.sessions)
  .values({ id: "s-1", name: "Evening PT", date: "2026-07-23T18:00:00Z" })
  .run();
db.insert(t.sessionEntries)
  .values({ id: "e-1", sessionId: "s-1", exerciseId: "ex-1", position: 0 })
  .run();
db.insert(t.workoutSets)
  .values([
    { id: "w-1", entryId: "e-1", sessionId: "s-1", position: 0, weight: 100, reps: 5, done: true },
    { id: "w-2", entryId: "e-1", sessionId: "s-1", position: 1, weight: 105, reps: 3, done: false },
  ])
  .run();

// per-session replacement path used by saveSession
db.delete(t.workoutSets).where(eq(t.workoutSets.sessionId, "s-1")).run();
db.delete(t.sessionEntries).where(eq(t.sessionEntries.sessionId, "s-1")).run();
assert(db.select().from(t.workoutSets).all().length === 0, "set replacement");

// --- personal records ---
db.insert(t.personalRecords)
  .values({
    id: "pr-1",
    exerciseId: "ex-1",
    kind: "1rm",
    value: 117.5,
    reps: 5,
    date: "2026-07-23T18:30:00Z",
    manual: false,
  })
  .run();
const prs = db.select().from(t.personalRecords).all();
assert(prs.length === 1 && prs[0].value === 117.5, "pr roundtrip");

// --- settings ---
db.insert(t.settings)
  .values({ key: "units", value: "metric" })
  .onConflictDoUpdate({ target: t.settings.key, set: { value: "imperial" } })
  .run();
db.insert(t.settings)
  .values({ key: "units", value: "metric" })
  .onConflictDoUpdate({ target: t.settings.key, set: { value: "imperial" } })
  .run();
const units = db.select().from(t.settings).where(eq(t.settings.key, "units")).all();
assert(units.length === 1 && units[0].value === "imperial", "settings upsert");

// --- built-in content coverage ---
// Every built-in exercise must have its OWN animation and cues. Falling
// back to the category archetype silently shows the wrong movement (this
// is how Air Squat ended up demonstrating a push-up), so it is a failure.
const seeded = seedExercises();
const uncovered = seeded.filter((e) => !hasLibraryEntry(e.id)).map((e) => e.name);
assert(uncovered.length === 0, `exercises without an animation: ${uncovered.join(", ")}`);

// Every template must reference exercises that actually exist, or the
// player silently drops stations and the prescribed timing is wrong.
const seededIds = new Set(seeded.map((e) => e.id));
for (const tpl of seedTemplates()) {
  const missing = tpl.exerciseIds.filter((id) => !seededIds.has(id));
  assert(missing.length === 0, `${tpl.name} references unknown exercises: ${missing.join(", ")}`);
}

console.log("DB smoke test passed ✔");
