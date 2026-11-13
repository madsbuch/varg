/**
 * Smoke test: apply the drizzle-kit migrations in /drizzle to an
 * in-memory SQLite (bun:sqlite), then run representative CRUD through
 * the same Drizzle schema the app uses. Catches broken migrations or
 * schema/query mismatches before they ship.
 *
 * It also guards the code-authoring path: programs are written by an agent
 * editing seed.ts, so anything a reviewer would have caught has to be caught
 * here instead. Content that builds green and runs wrong on the phone is the
 * worst outcome — see CLAUDE.md.
 *
 * Run with: bun run db:smoke
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as t from "../src/db/schema";
import { EX, seedExercises, seedTemplates } from "../src/lib/seed";
import { exerciseGear, hasLibraryEntry, libraryFor } from "../src/lib/library";
import { GEAR, templateExerciseIds, templateGear } from "../src/lib/gear";
import type { GearId } from "../src/lib/gear";
import { buildSongStyle, buildStyle, STYLE_LIMIT } from "../src/lib/music";
import { BUILT_IN_SONGS, INTENSITY_NAMES, SETS, setById } from "../src/lib/songs";
import { lengthBucket } from "../src/lib/catalog";
import * as prsModule from "../src/lib/prs";
import { estimate1RM } from "../src/lib/units";
import * as typesModule from "../src/types";
import type {
  Exercise,
  Metric,
  PRDirection,
  PRKind,
  Session,
  WorkoutSet,
} from "../src/types";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

/** Values that appear more than once, in first-seen order. */
function dupes(xs: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const x of xs) {
    if (seen.has(x)) out.add(x);
    seen.add(x);
  }
  return [...out];
}

// --- migrations ---
// Applied exactly like the app does (SqlitePersistence.migrate): sorted
// files, split on drizzle's statement-breakpoint markers, and each file
// plus its own __migrations row sent as ONE `BEGIN; ...; COMMIT;` batch.
// The batching is not cosmetic — it is what makes a part-failed migration
// roll back instead of leaving half a schema with no bookkeeping row, so
// running the statements one at a time here would exercise a code path the
// app no longer has. Values are inlined for the same reason as in the app:
// a parameter list binds to the first statement of a batch only.
const dir = join(import.meta.dir, "..", "drizzle");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) throw new Error("No migration files found in /drizzle");

const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function applyMigrations(): string[] {
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const rows = sqlite.query("SELECT name FROM __migrations").all() as { name: string }[];
  const applied = new Set(rows.map((r) => r.name));
  const fresh: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const stmts = readFileSync(join(dir, f), "utf8")
      .split("--> statement-breakpoint")
      .map((raw) => raw.trim())
      .filter((stmt) => stmt !== "")
      .map((stmt) => (stmt.endsWith(";") ? stmt : `${stmt};`));
    stmts.push(
      `INSERT INTO __migrations (name, applied_at) VALUES (${quote(f)}, ${quote(new Date().toISOString())});`,
    );
    try {
      // Mirrors SqlitePersistence.migrate(): one atomic batch, no explicit
      // ROLLBACK — the aborted transaction dies with the connection.
      sqlite.run(`BEGIN;\n${stmts.join("\n")}\nCOMMIT;`);
    } catch (err) {
      throw new Error(`SMOKE FAIL: migration ${f} failed: ${String(err)}`);
    }
    fresh.push(f);
  }
  return fresh;
}

const firstPass = applyMigrations();
assert(
  firstPass.length === files.length,
  `first pass applied ${firstPass.length} of ${files.length} migrations`,
);
// Every launch after the first re-enters migrate() against a database that
// already has the tables. The bookkeeping is the only thing standing between
// that and `table ... already exists`, which bricks the app on the splash —
// so run the whole thing a second time through the same __migrations rows.
const secondPass = applyMigrations();
assert(secondPass.length === 0, `re-applied on relaunch: ${secondPass.join(", ")}`);
const bookkeeping = sqlite.query("SELECT name FROM __migrations").all() as { name: string }[];
assert(
  bookkeeping.length === files.length && dupes(bookkeeping.map((r) => r.name)).length === 0,
  `__migrations holds ${bookkeeping.length} rows for ${files.length} migration files`,
);
console.log(`applied ${files.length} migration(s); relaunch is a no-op`);

// --- upgrade path: 0001 drops training splits ---
// Splits were removed from the app. A device that ran 0000 holds the split
// tables, possibly with rows, and sessions carrying split_id/split_day_id.
// The drop must go through on such a database (a failure here hangs the
// app on the splash) and must leave every logged session intact.
{
  const old = new Database(":memory:");
  const batch = (f: string) => {
    const stmts = readFileSync(join(dir, f), "utf8")
      .split("--> statement-breakpoint")
      .map((raw) => raw.trim())
      .filter((stmt) => stmt !== "")
      .map((stmt) => (stmt.endsWith(";") ? stmt : `${stmt};`));
    old.run(`BEGIN;\n${stmts.join("\n")}\nCOMMIT;`);
  };
  const init = files.find((f) => f.startsWith("0000_"));
  const drop = files.find((f) => f.startsWith("0001_"));
  assert(init && drop, "expected 0000 and 0001 migrations");
  batch(init);
  old.run(`INSERT INTO splits (id, name, built_in) VALUES ('split-ppl', 'Push / Pull / Legs', 1)`);
  old.run(`INSERT INTO split_days (id, split_id, name, position) VALUES ('ppl-push', 'split-ppl', 'Push', 0)`);
  old.run(`INSERT INTO split_day_exercises (day_id, exercise_id, position) VALUES ('ppl-push', 'ex-bench', 0)`);
  old.run(`INSERT INTO sessions (id, name, date, split_id, split_day_id) VALUES ('s-old', 'PPL — Push', '2026-01-01T07:00:00Z', 'split-ppl', 'ppl-push')`);
  old.run(`INSERT INTO session_entries (id, session_id, exercise_id, position) VALUES ('e-old', 's-old', 'ex-bench', 0)`);
  old.run(`INSERT INTO workout_sets (id, entry_id, session_id, position, weight, reps, done) VALUES ('w-old', 'e-old', 's-old', 0, 80, 5, 1)`);
  try {
    batch(drop);
  } catch (err) {
    throw new Error(`SMOKE FAIL: ${drop} failed on a database with split data: ${String(err)}`);
  }
  const tables = (old.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  assert(!tables.some((n) => n.startsWith("split")), `split tables survived ${drop}: ${tables.join(", ")}`);
  const cols = (old.query("PRAGMA table_info(sessions)").all() as { name: string }[]).map((r) => r.name);
  assert(!cols.includes("split_id") && !cols.includes("split_day_id"), `sessions still has split columns: ${cols.join(", ")}`);
  const kept = old.query("SELECT name FROM sessions WHERE id = 's-old'").get() as { name: string } | null;
  assert(kept?.name === "PPL — Push", "a session logged from a split day was lost");
  const sets = old.query("SELECT weight, reps FROM workout_sets WHERE session_id = 's-old'").all() as { weight: number; reps: number }[];
  assert(sets.length === 1 && sets[0]?.weight === 80 && sets[0].reps === 5, "a split-day session lost its sets");
  old.close();
  console.log(`${drop} drops splits and keeps logged sessions`);
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

// heart rate rides on the session row as JSON (migration 0002)
db.update(t.sessions)
  .set({ heartRate: JSON.stringify({ avg: 142, max: 178, every: 5, trace: [120, 0, 178] }) })
  .where(eq(t.sessions.id, "s-1"))
  .run();
const withHr = db.select().from(t.sessions).where(eq(t.sessions.id, "s-1")).all();
const hr = JSON.parse(withHr[0]?.heartRate ?? "null") as { avg: number; trace: number[] } | null;
assert(hr?.avg === 142 && hr.trace.length === 3, "session heart-rate roundtrip");

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

// Ids are foreign keys in the user's database — a collision would make two
// different movements share one exercise and one set of personal records.
const seededIds = new Set(seeded.map((e) => e.id));
assert(
  seededIds.size === seeded.length,
  `duplicate exercise ids: ${dupes(seeded.map((e) => e.id)).join(", ")}`,
);

// Every reference to an exercise must resolve. A typo'd id is invisible at
// runtime — templates refuse to start — and nothing in the type system objects because these are plain strings.
for (const tpl of seedTemplates()) {
  const missing = tpl.exerciseIds.filter((id) => !seededIds.has(id));
  assert(missing.length === 0, `template "${tpl.name}" references unknown exercises: ${missing.join(", ")}`);
}
// Duplicate template ids would make one shadow the other in the UI
// and share a battle-track cache key.
const tplIds = seedTemplates().map((x) => x.id);
assert(new Set(tplIds).size === tplIds.length, "duplicate template ids");

// A template with an `interval` runs as a fixed work/rest circuit in the
// guided player, and the card renders the scheme verbatim next to a single
// Start button. A scheme prescribing metres, an AMRAP score or a rep count
// therefore promises something the player cannot measure or deliver: the
// player logs {seconds: work} and nothing else.
//
// The allowlist is deliberate — a bare /\d+\s*m/ false-positives on
// Rasteplads' correct "— 3 min a round", so numbers are checked against the
// unit that follows them instead.
const INTERVAL_SCHEME_UNITS = new Set([
  "s", "sec", "secs", "second", "seconds",
  "min", "mins", "minute", "minutes",
  "round", "rounds", "station", "stations",
  "kg", "cm",
]);
const DISTANCE_RE = /\d+(?:[.,]\d+)?\s*(?:m|km|meters|metres)\b/iu;
const AMRAP_RE = /\bAMRAP\b/iu;
const COUNTED_RE = /(\d+(?:[.,]\d+)?)\s*(\p{L}[\p{L}-]*)?/gu;

for (const tpl of seedTemplates()) {
  if (!tpl.interval) continue;
  const wrong = new Set<string>();
  if (DISTANCE_RE.test(tpl.scheme)) wrong.add("prescribes a distance");
  if (AMRAP_RE.test(tpl.scheme)) wrong.add("prescribes an AMRAP score");
  const counts: string[] = [];
  for (const m of tpl.scheme.matchAll(COUNTED_RE)) {
    const unit = m[2]?.toLowerCase();
    if (unit && !INTERVAL_SCHEME_UNITS.has(unit)) counts.push(m[0].trim());
  }
  if (counts.length > 0) wrong.add(`counts ${counts.map((c) => `"${c}"`).join(", ")}`);
  assert(
    wrong.size === 0,
    `template "${tpl.name}" has an interval but its scheme ${[...wrong].join(" and ")}: ` +
      `"${tpl.scheme}". Write the scheme in the units the interval enforces ` +
      `("3 rounds · 12 stations · 20 s work / 10 s rest"), or drop the interval ` +
      `so it opens as a loggable session.`,
  );
}

// Bounds on the prescription itself. Train builds one step object per station
// per round up front and WodPlayer scans that array on every render, so an
// absurd round count is a frozen phone rather than an error.
const MAX_STEPS = 200;
const MAX_DURATION = 2 * 60 * 60;
for (const tpl of seedTemplates()) {
  const iv = tpl.interval;
  if (!iv) continue;
  const where = `template "${tpl.name}" interval`;
  const stations = tpl.exerciseIds.length;
  assert(stations >= 1, `${where}: no stations`);
  assert(
    Number.isInteger(iv.rounds) && iv.rounds >= 1 && iv.rounds <= 50,
    `${where}: rounds must be a whole number 1-50, got ${iv.rounds}`,
  );
  assert(
    Number.isInteger(iv.work) && iv.work >= 5 && iv.work <= 600,
    `${where}: work must be a whole number of seconds 5-600, got ${iv.work}`,
  );
  assert(
    Number.isInteger(iv.rest) && iv.rest >= 0 && iv.rest <= 600,
    `${where}: rest must be a whole number of seconds 0-600, got ${iv.rest}`,
  );
  const steps = stations * iv.rounds;
  assert(
    steps <= MAX_STEPS,
    `${where}: ${steps} steps (${stations} stations × ${iv.rounds} rounds) exceeds ${MAX_STEPS}`,
  );
  const seconds = steps * iv.work + Math.max(0, steps - 1) * iv.rest;
  assert(
    seconds <= MAX_DURATION,
    `${where}: runs ${Math.round(seconds / 60)} min, over the ${MAX_DURATION / 60} min ceiling`,
  );
}

// Every metric must map to a declared PR direction, and the declaration must
// match what recomputePRs actually keeps. Before this landed, types.ts
// documented "time" as "fastest time (lower is better)" while recomputePRs
// took Math.max, so an agent adding a for-time run stored the WORST time as
// the record — green build, green smoke test, silently wrong record.
//
// The declaration lives in types.ts next to PRKind (an exhaustive Record, so a
// new kind cannot be added without a direction); prs.ts is accepted too in case
// it ever moves next to the comparisons that consume it.
const declared = {
  ...(typesModule as { PR_DIRECTION?: Record<PRKind, PRDirection> }).PR_DIRECTION,
  ...(prsModule as { PR_DIRECTION?: Record<PRKind, PRDirection> }).PR_DIRECTION,
};
const prDirection = (prsModule as { prDirection?: (kind: PRKind) => PRDirection }).prDirection;
const directionOf = prDirection ?? ((kind: PRKind) => declared[kind]);
assert(
  prDirection ?? Object.keys(declared).length > 0,
  'a direction must be declared per PR kind — export `PR_DIRECTION: Record<PRKind, "higher" | "lower">` ' +
    "from types.ts (or `prDirection(kind)` from prs.ts) and reconcile it with the doc comment on PRKind",
);

// Two sessions per metric, the later one carrying the numerically larger
// value: whichever survives tells us the direction recomputePRs implements.
const METRIC_PROBES: {
  metric: Metric;
  lo: Partial<WorkoutSet>;
  hi: Partial<WorkoutSet>;
  values: Partial<Record<PRKind, [number, number]>>;
}[] = [
  {
    metric: "weight_reps",
    lo: { weight: 100, reps: 5 },
    hi: { weight: 120, reps: 5 },
    values: { "1rm": [estimate1RM(100, 5), estimate1RM(120, 5)], weight: [100, 120] },
  },
  { metric: "reps", lo: { reps: 10 }, hi: { reps: 20 }, values: { reps: [10, 20] } },
  { metric: "time", lo: { seconds: 60 }, hi: { seconds: 90 }, values: { time: [60, 90] } },
  {
    metric: "distance_time",
    lo: { meters: 1000 },
    hi: { meters: 2000 },
    values: { distance: [1000, 2000] },
  },
];

const probed = new Set(METRIC_PROBES.map((p) => p.metric));
const unprobed = [...new Set(seeded.map((e) => e.metric))].filter((m) => !probed.has(m));
assert(unprobed.length === 0, `metrics with no PR-direction probe: ${unprobed.join(", ")}`);

for (const probe of METRIC_PROBES) {
  const ex: Exercise = {
    id: `dir-${probe.metric}`,
    name: probe.metric,
    category: "conditioning",
    metric: probe.metric,
    muscles: [],
    builtIn: false,
  };
  const session = (id: string, date: string, vals: Partial<WorkoutSet>): Session => ({
    id,
    name: id,
    date,
    entries: [
      { id: `${id}-e`, exerciseId: ex.id, sets: [{ id: `${id}-s`, done: true, ...vals }] },
    ],
  });
  const got = prsModule.recomputePRs(
    [
      session("lo", "2026-01-01T00:00:00Z", probe.lo),
      session("hi", "2026-01-02T00:00:00Z", probe.hi),
    ],
    [ex],
    [],
  );
  for (const kind of prsModule.prKindsFor(ex)) {
    const pair = probe.values[kind];
    assert(pair, `no probe value for ${probe.metric}/${kind} — add one alongside the metric`);
    const dir = directionOf(kind);
    assert(
      dir === "higher" || dir === "lower",
      `PR kind "${kind}" (metric ${probe.metric}) has no declared direction`,
    );
    const rows = got.filter((p) => p.kind === kind);
    assert(rows.length === 1, `recomputePRs kept ${rows.length} PRs for ${probe.metric}/${kind}`);
    const [row] = rows;
    assert(row, `recomputePRs kept no PR for ${probe.metric}/${kind}`);
    const want = dir === "higher" ? Math.max(...pair) : Math.min(...pair);
    assert(
      Math.abs(row.value - want) < 1e-9,
      `${probe.metric}/${kind} is declared "${dir} is better" but recomputePRs kept ` +
        `${row.value} where it should keep ${want}`,
    );
  }
}

// For-time templates run in ForTimePlayer: one Done per stage, and each
// completed stage is logged as a set carrying the prescribed amount. So the
// amount must be the kind the exercise's metric measures, and the label the
// athlete reads mid-workout must state that same number — a label saying
// "100 pull-ups" over a stage logging 10 is the silent mismatch to prevent.
{
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  for (const tpl of seedTemplates()) {
    const ft = tpl.forTime;
    if (!ft) continue;
    const where = `template "${tpl.name}" forTime`;
    assert(!tpl.interval, `${where}: has both an interval and forTime — pick one player`);
    assert(ft.stages.length >= 1 && ft.stages.length <= 200, `${where}: needs 1-200 stages, has ${ft.stages.length}`);
    ft.stages.forEach((st, i) => {
      const at = `${where} stage ${i + 1} ("${st.label}")`;
      const ex = exById.get(st.exerciseId);
      assert(ex, `${at}: exercise ${st.exerciseId} does not exist`);
      assert(
        tpl.exerciseIds.includes(st.exerciseId),
        `${at}: ${ex.name} is not in the template's exerciseIds, so the details sheet would not show its cues`,
      );
      if (ex.metric === "reps" || ex.metric === "weight_reps") {
        assert(
          Number.isInteger(st.reps) && (st.reps ?? 0) > 0 && st.meters == null,
          `${at}: ${ex.name} is counted in reps — give the stage a whole-number reps target and no metres`,
        );
        assert(
          new RegExp(`(^|\\D)${String(st.reps)}(\\D|$)`).test(st.label),
          `${at}: label does not state the ${String(st.reps)} reps the stage logs`,
        );
      } else if (ex.metric === "distance_time") {
        assert(
          (st.meters ?? 0) > 0 && st.reps == null,
          `${at}: ${ex.name} is measured in distance — give the stage a metres target and no reps`,
        );
        const m = st.meters ?? 0;
        assert(
          st.label.includes(`${String(m / 1000)} km`) || st.label.includes(`${String(m)} m`),
          `${at}: label does not state the ${String(m)} m the stage logs`,
        );
      } else {
        assert(false, `${at}: ${ex.name} is a ${ex.metric} exercise, which a for-time stage cannot prescribe`);
      }
    });
  }
}

// Flows (yoga) run in the guided player step by step, each pose its own
// length, and the card prints the scheme beside a computed total. So: every
// pose resolves and is in exerciseIds (the details sheet's cues), holds are
// sane whole seconds, one-sided poses come as an adjacent left/right pair on
// an animation that declares which side it draws (or the mirror would show
// the wrong leg), and the scheme's pose count, hold range and total are the
// flow's own numbers — the arithmetic the owner reads must be the arithmetic
// the player runs.
{
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  for (const tpl of seedTemplates()) {
    const fl = tpl.flow;
    if (!fl) continue;
    const where = `template "${tpl.name}" flow`;
    assert(!tpl.interval && !tpl.forTime, `${where}: also has an interval or forTime — pick one player`);
    assert(fl.steps.length >= 1 && fl.steps.length <= 200, `${where}: needs 1-200 steps`);
    fl.steps.forEach((st, i) => {
      const at = `${where} step ${i + 1}`;
      const ex = exById.get(st.exerciseId);
      assert(ex, `${at}: exercise ${st.exerciseId} does not exist`);
      assert(tpl.exerciseIds.includes(st.exerciseId), `${at}: ${ex.name} missing from exerciseIds`);
      assert(Number.isInteger(st.seconds) && st.seconds >= 10 && st.seconds <= 300, `${at}: hold must be 10-300 whole seconds, got ${st.seconds}`);
      if (st.side) {
        const entry = libraryFor(ex);
        assert(entry.side, `${at}: ${ex.name} is one-sided but its animation does not declare which side it draws`);
        const pair = st.side === "left" ? fl.steps[i + 1] : fl.steps[i - 1];
        assert(
          pair?.exerciseId === st.exerciseId && pair.side === (st.side === "left" ? "right" : "left"),
          `${at}: ${ex.name} ${st.side} side is not paired with the ${st.side === "left" ? "right" : "left"} side next to it`,
        );
        assert(st.side === "right" || pair.seconds === st.seconds, `${at}: ${ex.name} sides are held for different times`);
      }
    });
    assert(
      Number.isInteger(fl.transition) && fl.transition >= 0 && fl.transition <= 60,
      `${where}: transition must be 0-60 whole seconds, got ${fl.transition}`,
    );
    const total = fl.steps.reduce((sum, st) => sum + st.seconds, 0) + (fl.steps.length - 1) * fl.transition;
    const holds = fl.steps.map((st) => st.seconds);
    const expected = [
      `${fmt(total)} flow`,
      `${fl.steps.length} poses`,
      `holds of ${Math.min(...holds)}–${Math.max(...holds)} s`,
      ...(fl.transition > 0 ? [`${fl.transition} s to move between poses`] : []),
    ];
    for (const part of expected) {
      assert(tpl.scheme.includes(part), `${where}: scheme "${tpl.scheme}" does not say "${part}"`);
    }
  }
}

// EMOMs run in the guided player: every station owns one whole minute,
// work until Done (reps) or until its timed target has run, rest after.
// So: every exercise resolves and is in exerciseIds (the details sheet's
// cues), a station prescribes reps exactly when its exercise counts reps
// and its target label says those numbers, timed work fits inside the
// minute, and the scheme states the real total, warm-up, EMOM length,
// rounds and stations — the arithmetic the owner reads is what runs.
{
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  const range = (r: [number, number]) => (r[0] === r[1] ? String(r[0]) : `${String(r[0])}–${String(r[1])}`);
  for (const tpl of seedTemplates()) {
    const em = tpl.emom;
    if (!em) continue;
    const where = `template "${tpl.name}" emom`;
    assert(Number.isInteger(em.minute) && em.minute >= 30 && em.minute <= 300, `${where}: minute must be 30-300 whole seconds, got ${em.minute}`);
    assert(Number.isInteger(em.rounds) && em.rounds >= 1 && em.rounds <= 50, `${where}: rounds must be 1-50, got ${em.rounds}`);
    assert(em.stations.length >= 1 && em.stations.length * em.rounds <= 200, `${where}: needs 1-200 station minutes`);
    em.stations.forEach((st, i) => {
      const at = `${where} station ${i + 1} ("${st.target}")`;
      const ex = exById.get(st.exerciseId);
      assert(ex, `${at}: exercise ${st.exerciseId} does not exist`);
      assert(tpl.exerciseIds.includes(st.exerciseId), `${at}: ${ex.name} missing from exerciseIds`);
      assert((st.reps === undefined) !== (st.seconds === undefined), `${at}: needs exactly one of reps or seconds`);
      if (st.reps) {
        const [lo, hi] = st.reps;
        assert(ex.metric === "reps" || ex.metric === "weight_reps", `${at}: ${ex.name} is a ${ex.metric} exercise, not counted in reps`);
        assert(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && lo <= hi, `${at}: reps must be whole numbers, low to high`);
        assert(st.target.includes(`${range(st.reps)} reps`), `${at}: target does not say "${range(st.reps)} reps"`);
      }
      if (st.seconds) {
        const [lo, hi] = st.seconds;
        assert(ex.metric === "time", `${at}: ${ex.name} is a ${ex.metric} exercise, not timed`);
        assert(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 5 && lo <= hi && hi < em.minute, `${at}: timed work must be 5 s up to under the minute, low to high`);
        assert(st.target.includes(`${range(st.seconds)} s`), `${at}: target does not say "${range(st.seconds)} s"`);
      }
    });
    const warmup = em.warmup ?? [];
    warmup.forEach((w, i) => {
      const at = `${where} warm-up ${i + 1}`;
      const ex = exById.get(w.exerciseId);
      assert(ex, `${at}: exercise ${w.exerciseId} does not exist`);
      assert(tpl.exerciseIds.includes(w.exerciseId), `${at}: ${ex.name} missing from exerciseIds`);
      assert(Number.isInteger(w.seconds) && w.seconds >= 10 && w.seconds <= 600, `${at}: 10-600 whole seconds, got ${w.seconds}`);
    });
    const warm = warmup.reduce((a, w) => a + w.seconds, 0);
    const main = em.rounds * em.stations.length * em.minute;
    const expected = [
      fmt(warm + main),
      ...(warm > 0 ? [`${fmt(warm)} warm-up`] : []),
      `${fmt(main)} EMOM`,
      `${String(em.rounds)} rounds`,
      `${String(em.stations.length)} stations`,
    ];
    for (const part of expected) assert(tpl.scheme.includes(part), `${where}: scheme "${tpl.scheme}" does not say "${part}"`);
  }
}

// The kit list on every card is derived from the exercises' declared gear.
// A template's own entries can only qualify that list or add what no
// exercise implies: a detail for gear the workout does not use ("24 kg"
// for a kettlebell nobody swings) would print a line the list never shows,
// and an extra that an exercise already brings is a second source of truth.
for (const tpl of seedTemplates()) {
  const where = `template "${tpl.name}" gear`;
  const derived = new Set<GearId>(templateExerciseIds(tpl).flatMap((id) => exerciseGear(id)));
  for (const id of tpl.gear?.extra ?? []) {
    assert(id in GEAR, `${where}: unknown gear "${id}"`);
    assert(!derived.has(id), `${where}: "${id}" comes from its exercises already; drop it from extra`);
  }
  const listed = new Set(templateGear(tpl, exerciseGear).map((g) => g.id));
  for (const id of Object.keys(tpl.gear?.detail ?? {})) {
    assert(listed.has(id as GearId), `${where}: detail for "${id}", which the workout does not use`);
  }
}

// Rides run in the ride player against live bike data. Each segment ends
// on time or on kcal — exactly one — and its targets must be sane, or the
// player shows a target no rider can hold. A kcal segment makes the ride a
// race (scored by total time), so it must say so.
{
  const players = (t: { interval?: unknown; forTime?: unknown; flow?: unknown; ride?: unknown; emom?: unknown }) =>
    [t.interval, t.forTime, t.flow, t.ride, t.emom].filter((x) => x !== undefined).length;
  for (const tpl of seedTemplates()) {
    assert(players(tpl) <= 1, `template "${tpl.name}": more than one of interval, forTime, flow, emom and ride`);
    const r = tpl.ride;
    if (!r) continue;
    const where = `template "${tpl.name}" ride`;
    assert(tpl.exerciseIds.length === 1 && tpl.exerciseIds[0] === EX.spinBike, `${where}: exerciseIds must be [EX.spinBike]`);
    if (r.free) {
      // The bike console: no program at all, so nothing to time or race.
      assert(r.segments.length === 0 && r.race !== true, `${where}: a free ride has no segments and is no race`);
      continue;
    }
    assert(r.segments.length >= 1 && r.segments.length <= 100, `${where}: needs 1-100 segments`);
    let anyKcal = false;
    r.segments.forEach((sg, i) => {
      const at = `${where} segment ${i + 1} ("${sg.label}")`;
      assert((sg.seconds === undefined) !== (sg.kcal === undefined), `${at}: needs exactly one of seconds or kcal`);
      if (sg.seconds !== undefined) assert(Number.isInteger(sg.seconds) && sg.seconds >= 5 && sg.seconds <= 4 * 3600, `${at}: seconds must be 5-14400`);
      if (sg.kcal !== undefined) {
        anyKcal = true;
        assert(Number.isInteger(sg.kcal) && sg.kcal >= 5 && sg.kcal <= 3000, `${at}: kcal must be 5-3000`);
      }
      const [lo, hi] = sg.ftp;
      assert(lo >= 20 && hi <= 300 && lo < hi, `${at}: FTP target ${lo}-${hi} % is not a sane range`);
      if (sg.cadence) assert(sg.cadence[0] >= 40 && sg.cadence[1] <= 160 && sg.cadence[0] < sg.cadence[1], `${at}: cadence target is not a sane range`);
      // Heart rate lags effort by a minute or more: a heart-rate block must
      // be long enough to settle into its zone, and ends on time — the
      // strap measures the target, not the work.
      if (sg.hrZone !== undefined) {
        assert(Number.isInteger(sg.hrZone) && sg.hrZone >= 1 && sg.hrZone <= 5, `${at}: hrZone must be a Garmin zone 1-5`);
        assert(sg.seconds !== undefined && sg.seconds >= 180, `${at}: a heart-rate block is timed and at least 3 minutes`);
        assert(tpl.scheme.includes(`heart-rate zone ${String(sg.hrZone)}`), `${at}: the scheme must say it rides in heart-rate zone ${String(sg.hrZone)}`);
      }
    });
    assert(anyKcal === (r.race === true), `${where}: a ride with kcal segments is a race (race: true), and only then`);
    // Adaptive music: the track's intensity is booked block by block, so a
    // block without one would leave the music wherever the last one put
    // it. And every timed block must be whole bars at the track's tempo,
    // or the changes drift off the downbeat.
    if (r.segments.some((sg) => sg.intensity !== undefined)) {
      // It plays one song set: its default must exist. The owner can pick
      // any set for it on the workout's page, so the tempo check below
      // holds every set's tempos.
      assert(tpl.music.set !== undefined && setById(tpl.music.set) !== undefined, `${where}: an adaptive ride needs music.set, one of ${SETS.map((x) => x.id).join(", ")}`);
      r.segments.forEach((sg, i) => {
        const at = `${where} segment ${i + 1} ("${sg.label}")`;
        assert(sg.intensity === 1 || sg.intensity === 2 || sg.intensity === 3, `${at}: an adaptive ride sets intensity 1-3 on every block`);
        if (sg.seconds !== undefined) {
          // Every set's tempo at every intensity, so a change between
          // tempos meets on the one whichever set the owner picks.
          for (const set of SETS) {
            for (const l of [1, 2, 3] as const) {
              const bpm = set.bpm[l];
              const bars = (sg.seconds * bpm) / 240;
              assert(Number.isInteger(bars), `${at}: ${sg.seconds} s at ${bpm} BPM (${set.name} ${INTENSITY_NAMES[l]}) is ${bars.toFixed(2)} bars; pick tempos that make it whole bars`);
            }
          }
        }
      });
    }
    assert(tpl.exerciseIds.length === 1 && tpl.exerciseIds[0] === EX.spinBike, `${where}: exerciseIds must be [EX.spinBike]`);
  }
}

// The library filters every workout by level and length. A template that
// cannot say how long it takes would silently drop out of every length
// filter, so: an estimate exactly when the length is not computable.
for (const tpl of seedTemplates()) {
  const where = `template "${tpl.name}"`;
  assert(["beginner", "intermediate", "advanced"].includes(tpl.level), `${where}: level must be beginner, intermediate or advanced`);
  const computed = tpl.interval !== undefined || tpl.flow !== undefined || tpl.emom !== undefined ||
    (tpl.ride !== undefined && !tpl.ride.free && tpl.ride.segments.every((sg) => sg.seconds !== undefined));
  if (computed) {
    assert(tpl.estimateMinutes === undefined, `${where}: has an exact clock time, so no estimateMinutes`);
  } else {
    const m = tpl.estimateMinutes;
    assert(m !== undefined && Number.isInteger(m) && m >= 1 && m <= 600, `${where}: needs estimateMinutes (typical finishing time, 1-600)`);
  }
  assert(lengthBucket(tpl) !== undefined, `${where}: falls in no length bucket`);
}

// Every built-in's music description must fit the gateway's limit untrimmed — a
// truncated prompt silently loses the end of its style description.
for (const tpl of seedTemplates()) {
  const styles = [buildStyle(tpl.name, tpl.music, tpl.interval)];
  for (const style of styles) {
    assert(
      !style.endsWith("…") && style.length <= STYLE_LIMIT,
      `template "${tpl.name}" music style is truncated to ${STYLE_LIMIT} chars — shorten its theme or style`,
    );
  }
}

// The song library: permanent unique ids, every song in a set at that
// set's tempo for its intensity, a style that fits the gateway untrimmed,
// lyrics only in Suno's sectioned format, and every set able to play every
// intensity from its built-in songs alone.
{
  const ids = new Set<string>();
  for (const set of SETS) {
    for (const l of [1, 2, 3] as const) {
      assert(BUILT_IN_SONGS.some((x) => x.set === set.id && x.intensity === l), `set "${set.name}": no built-in ${INTENSITY_NAMES[l]} song`);
    }
  }
  for (const song of BUILT_IN_SONGS) {
    assert(!ids.has(song.id), `song "${song.id}": duplicate id`);
    ids.add(song.id);
    assert(!song.id.startsWith("user-"), `song "${song.id}": built-in ids must not look like the owner's (user-…)`);
    const set = setById(song.set);
    assert(set !== undefined, `song "${song.id}": no set "${song.set}"`);
    assert(song.bpm === set?.bpm[song.intensity], `song "${song.id}": bpm ${song.bpm} is not its set's ${String(set?.bpm[song.intensity])}`);
    const style = buildSongStyle(song);
    assert(!style.endsWith("…") && style.length <= STYLE_LIMIT, `song "${song.id}": style is truncated to ${STYLE_LIMIT} chars`);
    if (song.lyrics !== undefined) {
      assert(/^\[[A-Za-z ]+\]/.test(song.lyrics), `song "${song.id}": lyrics must open with a [Section] tag`);
      assert(song.lyrics.length <= 3000, `song "${song.id}": lyrics over 3000 chars`);
    }
  }
}

console.log("DB smoke test passed ✔");
