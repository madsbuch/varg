/**
 * Content check: the guards on the built-in workout content.
 *
 * Programs are written by an agent editing seed.ts, so anything a reviewer
 * would have caught has to be caught here instead. Content that builds
 * green and runs wrong on the phone is the worst outcome — see CLAUDE.md.
 *
 * The database itself (migrations, the upgrade from the Drizzle era, every
 * read and write) is tested in Rust: `bun run test:store`.
 *
 * Run with: bun run check:content
 */
import { seedExercises, seedTemplates } from "../src/lib/seed";
import { hasLibraryEntry } from "../src/lib/library";
import { buildSongStyle, STYLE_LIMIT } from "../src/lib/music";
import { BUILT_IN_SONGS, INTENSITY_NAMES, SETS, setById } from "../src/lib/songs";
import { templateProblems } from "../src/lib/template-check";
import { PROGRAM_PREFIX } from "../src/lib/programs";
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`CONTENT CHECK FAIL: ${msg}`);
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

// Every template rule lives in src/lib/template-check.ts, shared with
// Mímir (the in-app trainer), which runs it over every program it proposes.
// See there for the reasons behind each rule.
for (const tpl of seedTemplates()) {
  const problems = templateProblems(tpl, seeded);
  assert(problems.length === 0, problems.join("\n  "));
}
// Duplicate template ids would make one shadow the other in the UI
// and share a battle-track cache key.
const tplIds = seedTemplates().map((x) => x.id);
assert(new Set(tplIds).size === tplIds.length, "duplicate template ids");
assert(tplIds.every((id) => !id.startsWith(PROGRAM_PREFIX)), `built-in template ids must not start with "${PROGRAM_PREFIX}" (Mímir's)`);

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

console.log("Content check passed ✔");
