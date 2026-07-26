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
import { seedExercises, seedSplits, seedTemplates } from "../src/lib/seed";
import { hasLibraryEntry } from "../src/lib/library";
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

// Ids are foreign keys in the user's database — a collision would make two
// different movements share one exercise and one set of personal records.
const seededIds = new Set(seeded.map((e) => e.id));
assert(
  seededIds.size === seeded.length,
  `duplicate exercise ids: ${dupes(seeded.map((e) => e.id)).join(", ")}`,
);

// Every reference to an exercise must resolve. A typo'd id is invisible at
// runtime — templates refuse to start, splits silently drop the exercise,
// and nothing in the type system objects because these are plain strings.
for (const tpl of seedTemplates()) {
  const missing = tpl.exerciseIds.filter((id) => !seededIds.has(id));
  assert(missing.length === 0, `template "${tpl.name}" references unknown exercises: ${missing.join(", ")}`);
}
for (const split of seedSplits()) {
  for (const day of split.days) {
    const missing = day.exerciseIds.filter((id) => !seededIds.has(id));
    assert(
      missing.length === 0,
      `split "${split.name}" day "${day.name}" references unknown exercises: ${missing.join(", ")}`,
    );
  }
}

// Duplicate template/split ids would make one shadow the other in the UI
// and share a battle-track cache key.
const tplIds = seedTemplates().map((x) => x.id);
assert(new Set(tplIds).size === tplIds.length, "duplicate template ids");
const splitIds = seedSplits().map((x) => x.id);
assert(new Set(splitIds).size === splitIds.length, "duplicate split ids");

// A day may not list the same exercise twice: split_day_exercises has PK
// (day_id, exercise_id), and saveSplit writes one bulk INSERT. The duplicate
// throws inside load(), which hangs the first launch on the splash — and
// since the splits and split_days rows commit first, launch 2 sees the id as
// known and skips the write forever, leaving every day permanently empty.
for (const split of seedSplits()) {
  for (const day of split.days) {
    const repeated = dupes(day.exerciseIds);
    assert(
      repeated.length === 0,
      `split "${split.name}" day "${day.name}" lists the same exercise twice: ${repeated.join(", ")}`,
    );
  }
}

// split_days.id is a global primary key, not scoped to its split, so a day id
// reused across two splits collides on insert — same fatal load() as above.
const dayIds = seedSplits().flatMap((s) => s.days.map((d) => d.id));
assert(dupes(dayIds).length === 0, `split day ids reused across splits: ${dupes(dayIds).join(", ")}`);

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

console.log("DB smoke test passed ✔");
