import { describe, expect, test } from "bun:test";
import {
  advanceProgress, buildSteps, clockElapsed, configForTemplate, emomAnnounceAt, emomPhase, emomRoundsTarget, newWodProgress,
  recordedEntries, recordedSession, seekClock, stepIndexAt, togglePauseClock,
} from "../src/lib/wod";
import type { Clock, WodConfig } from "../src/lib/wod";
import { templateLength } from "../src/lib/catalog";
import type { Template } from "../src/types";
import { recomputePRs } from "../src/lib/prs";
import { seedExercises, seedTemplates } from "../src/lib/seed";
import { allVoiceLines, cueLine, restLine } from "../src/lib/voice-clips";

const exercises = seedExercises();
const EX_DEAD_BUG = "ex-dead-bug";
const hold = exercises.find((ex) => ex.metric === "time")!;
const reps = exercises.find((ex) => ex.metric === "reps")!;
const config: WodConfig = {
  exercises: [hold, reps, hold], work: 20, rest: 10, rounds: 2,
  title: "Test circuit", trackKey: "test-circuit",
};
const steps = buildSteps(config);
const start = "2026-10-28T10:00:00.000Z";

function at(seconds: number) {
  const progress = newWodProgress();
  advanceProgress(progress, steps, seconds);
  return progress;
}

describe("guided workout recording", () => {
  test("ready countdown creates no sets", () => {
    const progress = at(5);
    expect(progress.duration).toBe(0);
    expect(recordedEntries(steps, progress)).toEqual([]);
  });

  test("early stop records a partial station without future stations or PRs", () => {
    const progress = at(12.5);
    const session = recordedSession(config, steps, progress, start, true);
    expect(progress.duration).toBe(7.5);
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0]!.sets).toHaveLength(1);
    expect(session.entries[0]!.sets[0]).toMatchObject({ seconds: 7.5, done: false });
    expect(session.date).toBe(start);
    expect(session.templateId).toBe("test-circuit");
    expect(session.note).toContain("Stopped early");
    expect(session.finishedAt).toBeTruthy();
    expect(recomputePRs([session], exercises, [])).toEqual([]);
  });

  test("stopping during rest logs no future station", () => {
    const progress = at(29);
    expect(progress.duration).toBe(24);
    expect(recordedEntries(steps, progress)[0]!.sets[0]!.seconds).toBe(20);
    expect(recordedEntries(steps, progress)).toHaveLength(1);
  });

  test("rep stations preserve timer duration without inventing reps", () => {
    const session = recordedSession(config, steps, at(42), start, true);
    expect(session.entries[1]!.sets[0]).toMatchObject({ seconds: 7, done: false });
    expect(session.entries[1]!.sets[0]!.reps).toBeUndefined();
  });

  test("pauses and repeated clock samples do not add time", () => {
    const progress = at(12);
    advanceProgress(progress, steps, 12);
    advanceProgress(progress, steps, 12);
    advanceProgress(progress, steps, 15);
    expect(progress.duration).toBe(10);
    expect(recordedEntries(steps, progress)[0]!.sets[0]!.seconds).toBe(10);
  });

  test("skip excludes unperformed work and back preserves actual time", () => {
    const progress = at(12);
    progress.position = 35; // seek to second station
    advanceProgress(progress, steps, 39);
    progress.position = 35; // restart second station
    advanceProgress(progress, steps, 38);
    const entries = recordedEntries(steps, progress);
    expect(progress.duration).toBe(14);
    expect(entries[0]!.sets[0]!.seconds).toBe(7);
    expect(entries[1]!.sets[0]!.seconds).toBe(7);
    expect(entries).toHaveLength(2);
  });

  test("standby catch-up records all traversed work once, capped at the end", () => {
    const progress = at(12);
    advanceProgress(progress, steps, 999);
    advanceProgress(progress, steps, 1000);
    expect(progress.duration).toBe(170);
    const session = recordedSession(config, steps, progress, start, false);
    expect(session.entries.map((entry) => entry.sets.length)).toEqual([4, 2]);
    expect(session.entries.flatMap((entry) => entry.sets).every((set) => set.seconds === 20)).toBe(true);
    expect(recomputePRs([session], exercises, [])).toEqual([]);
  });

  test("zero-rest workouts record the boundary correctly", () => {
    const continuous = buildSteps({ ...config, rest: 0 });
    const progress = newWodProgress();
    advanceProgress(progress, continuous, 25);
    expect(recordedEntries(continuous, progress)).toHaveLength(1);
    advanceProgress(progress, continuous, 29);
    expect(recordedEntries(continuous, progress)[1]!.sets[0]!.seconds).toBe(4);
  });
});

describe("flow (yoga) sequences", () => {
  const all = seedExercises();
  const pose = (name: string) => all.find((e) => e.name === name)!;
  const flow: WodConfig = {
    exercises: [], work: 0, rest: 0, rounds: 1, title: "Flow", trackKey: "flow",
    sequence: [
      { exercise: pose("Child's Pose"), secs: 40 },
      { exercise: pose("Warrior II"), secs: 35, side: "left" },
      { exercise: pose("Warrior II"), secs: 35, side: "right" },
    ],
  };
  const fsteps = buildSteps(flow);

  test("each pose is its own step with its own length and side, no rests", () => {
    expect(fsteps.map((s) => [s.kind, s.secs, s.side ?? null, s.round])).toEqual([
      ["ready", 5, null, 1],
      ["work", 40, null, 1],
      ["work", 35, "left", 2],
      ["work", 35, "right", 3],
    ]);
    expect(fsteps.map((s) => s.at)).toEqual([0, 5, 45, 80]);
  });

  test("a finished flow logs the holds it ran, without PRs", () => {
    const progress = newWodProgress();
    advanceProgress(progress, fsteps, 115);
    const session = recordedSession(flow, fsteps, progress, start, false);
    expect(session.entries.map((e) => e.sets.map((s) => s.seconds))).toEqual([[40], [35, 35]]);
    expect(session.note).toContain("3-pose flow");
    expect(recomputePRs([session], exercises, [])).toEqual([]);
  });
});

describe("spoken cue lines", () => {
  test("every line the player speaks is in the generated set, in its voice", () => {
    const lines = new Set(allVoiceLines().map((l) => `${l.role}|${l.text}`));
    const exById = new Map(seedExercises().map((e) => [e.id, e]));
    let spoken = 0;
    for (const t of seedTemplates()) {
      const cfg = configForTemplate(t, exById);
      if (typeof cfg === "string") continue;
      const all = buildSteps(cfg);
      for (const [i, step] of all.entries()) {
        for (const line of [cueLine(step), restLine(all, i)]) {
          if (!line) continue;
          spoken++;
          expect(lines.has(`${cfg.voice!}|${line}`)).toBe(true);
        }
      }
    }
    expect(spoken).toBeGreaterThan(50);
  });

  test("lines come before what they name: lead-in and rests, never during work", () => {
    const varg18 = seedTemplates().find((t) => t.id === "tpl-varg-18")!;
    const cfg = configForTemplate(varg18, new Map(seedExercises().map((e) => [e.id, e]))) as WodConfig;
    const steps = buildSteps(cfg);
    expect(cfg.voice).toBe("workout");
    expect(cueLine(steps[0]!)).toBe("First: Sit-up");
    expect(cueLine(steps[1]!)).toBe("");
    expect(cueLine(steps[2]!)).toBe("Next: Run on the Spot");
    expect(steps[2]!.kind).toBe("rest");
  });

  test("yoga flows move for 10 s between poses, voiced as the next pose", () => {
    const yoga = seedTemplates().find((t) => t.id === "tpl-varg-yoga-10")!;
    const cfg = configForTemplate(yoga, new Map(seedExercises().map((e) => [e.id, e]))) as WodConfig;
    const steps = buildSteps(cfg);
    expect(cfg.voice).toBe("yoga");
    expect(steps[0]!.secs).toBe(10);
    const moves = steps.filter((s) => s.kind === "rest");
    expect(moves).toHaveLength(16);
    expect(moves.every((s) => s.secs === 10)).toBe(true);
    // The work total (lead-in excluded) is what the scheme says: 12:40.
    expect(steps.reduce((a, s) => a + s.secs, 0) - steps[0]!.secs).toBe(760);
    const warrior = steps.findIndex((s) => s.kind === "rest" && s.side === "left" && s.exercise?.name === "Warrior II");
    expect(cueLine(steps[warrior]!)).toBe("Next: Warrior two, left side");
    expect(steps[warrior + 1]!.kind).toBe("work");
  });
});

describe("Full Body EMOM - 20 Minutes", () => {
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  const tpl = seedTemplates().find((t) => t.id === "tpl-full-body-emom-20")!;
  const cfgOf = (t: Template) => configForTemplate(t, exById) as WodConfig;
  const cfg = cfgOf(tpl);
  const steps = buildSteps(cfg);
  const lead = steps[0]!.secs;
  const name = (i: number) => steps[i]!.exercise!.name;
  /** The step the player shows at `s` seconds of workout time (lead-in excluded). */
  const at = (s: number) => steps[stepIndexAt(steps, lead + s)]!;

  test("runs exactly 20:00 after the lead-in: 2:00 warm-up, then 18 one-minute stations", () => {
    expect(typeof cfg).toBe("object");
    expect(steps[0]!.kind).toBe("ready");
    const total = steps.reduce((a, st) => a + st.secs, 0) - lead;
    expect(total).toBe(1200);
    expect(templateLength(tpl)).toEqual({ seconds: 1200, exact: true });
    const warm = steps.filter((st) => st.emom?.block === "warmup");
    expect(warm.map((st) => [st.exercise!.name, st.secs])).toEqual([
      ["Run on the Spot", 40], ["Arm Circles", 40], ["Air Squat", 40],
    ]);
    expect(warm.reduce((a, st) => a + st.secs, 0)).toBe(120);
    const stations = steps.filter((st) => st.emom?.block === "station");
    expect(stations).toHaveLength(18);
    expect(stations.every((st) => st.secs === 60 && st.kind === "work")).toBe(true);
    // No rest steps: an EMOM's rest lives inside each minute.
    expect(steps.some((st) => st.kind === "rest")).toBe(false);
  });

  test("three complete rounds of the six stations, in order, with targets", () => {
    const order = ["Burpee", "Reverse Lunge", "Push-up", "High Knees", "Band or Backpack Row", "Dead Bug"];
    const stations = steps.filter((st) => st.emom?.block === "station");
    for (let r = 0; r < 3; r++) {
      const round = stations.slice(r * 6, r * 6 + 6);
      expect(round.map((st) => st.exercise!.name)).toEqual(order);
      expect(round.every((st) => st.round === r + 1)).toBe(true);
      expect(round.map((st) => st.emom!.position)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(round.map((st) => st.at - lead)).toEqual([0, 1, 2, 3, 4, 5].map((m) => 120 + (r * 6 + m) * 60));
    }
    // One fixed count per round, never a range: burpees 8, then 10, then 12.
    const byRound = (n: number) => stations.slice((n - 1) * 6, n * 6).map((st) => st.emom!.target);
    expect(byRound(1)).toEqual(["8 reps", "16 reps · 8 per leg", "10 reps", "35 s", "12 reps", "10 reps"]);
    expect(byRound(2)).toEqual(["10 reps", "16 reps · 8 per leg", "12 reps", "38 s", "14 reps", "13 reps"]);
    expect(byRound(3)).toEqual(["12 reps", "16 reps · 8 per leg", "15 reps", "40 s", "15 reps", "16 reps"]);
    expect(stations.filter((st) => st.exercise!.name === "Burpee").map((st) => st.emom!.reps)).toEqual([8, 10, 12]);
    expect(stations.filter((st) => st.exercise!.name === "High Knees").map((st) => st.emom!.workSecs)).toEqual([35, 38, 40]);
    expect(stations.every((st) => !/[–-]\s*\d/.test(st.emom!.target))).toBe(true);
    expect(tpl.emom!.stations.map(emomRoundsTarget)).toEqual([
      "8 · 10 · 12 reps", "16 reps · 8 per leg", "10 · 12 · 15 reps", "35 · 38 · 40 s", "12 · 14 · 15 reps", "10 · 13 · 16 reps",
    ]);
  });

  test("transitions happen on the minute, by the clock alone", () => {
    expect(at(0).exercise!.name).toBe("Run on the Spot");
    expect(at(39.9).exercise!.name).toBe("Run on the Spot");
    expect(at(40).exercise!.name).toBe("Arm Circles");
    expect(at(119.9).exercise!.name).toBe("Air Squat");
    expect(at(120).exercise!.name).toBe("Burpee");
    expect(at(179.9).exercise!.name).toBe("Burpee");
    expect(at(180).exercise!.name).toBe("Reverse Lunge");
    // Minute 7 is round 2's burpees, minute 13 round 3's.
    expect([at(120 + 6 * 60), at(120 + 12 * 60)].map((st) => [st.exercise!.name, st.round])).toEqual([["Burpee", 2], ["Burpee", 3]]);
    expect(at(1199.9).exercise!.name).toBe("Dead Bug");
    expect(stepIndexAt(steps, lead + 1200)).toBe(steps.length - 1); // the player calls elapsed >= total done
    expect(name(steps.length - 1)).toBe("Dead Bug");
  });

  test("rep minutes show their target to the end; timed work rests by itself", () => {
    const burpees = at(120), knees = at(300), knees3 = at(120 + 15 * 60), warm = at(0);
    expect(emomPhase(warm, 39)).toBe("work");
    expect(emomPhase(burpees, 0)).toBe("work");
    expect(emomPhase(burpees, 59.9)).toBe("work"); // no Done: the target stays up all minute
    expect(knees.exercise!.name).toBe("High Knees");
    expect(emomPhase(knees, 34.9)).toBe("work"); // round 1: 35 s
    expect(emomPhase(knees, 35)).toBe("rest");
    expect([knees3.exercise!.name, knees3.round]).toEqual(["High Knees", 3]);
    expect(emomPhase(knees3, 39.9)).toBe("work"); // round 3: 40 s
    expect(emomPhase(knees3, 40)).toBe("rest");
    expect(emomPhase(steps[0]!, 1)).toBe("rest"); // lead-in is not work
    // The next exercise is named as a timed rest begins, else 10 s before the minute ends.
    expect(emomAnnounceAt(burpees)).toBe(50);
    expect(emomAnnounceAt(knees)).toBe(35);
    expect(emomAnnounceAt(warm)).toBeUndefined();
  });

  test("pause freezes the minute and resume continues it; standby lands on the right minute", () => {
    const t0 = 1_000_000;
    let clock: Clock = { anchor: t0, pausedAt: null };
    const s = (ms: number) => clockElapsed(clock, t0 + ms);
    expect(s(5_000 + 150_000)).toBe(155); // 30 s into the burpee minute
    clock = togglePauseClock(clock, t0 + 155_000);
    expect(s(155_000 + 600_000)).toBe(155); // ten paused minutes add nothing
    clock = togglePauseClock(clock, t0 + 755_000);
    expect(s(755_000)).toBe(155);
    expect(s(755_000 + 30_000)).toBe(185); // the minute ends 30 s after resuming
    expect(steps[stepIndexAt(steps, s(755_000 + 30_000))]!.exercise!.name).toBe("Reverse Lunge");
    // Frozen WebView: the next read, minutes later, is simply later.
    expect(steps[stepIndexAt(steps, s(755_000 + 30_000 + 9 * 60_000))]!.round).toBe(2);
    // Restart a minute (back) while paused: stays paused, at its top.
    clock = togglePauseClock(clock, t0 + 800_000);
    clock = seekClock(clock, t0 + 900_000, 180 + lead);
    expect(clock.pausedAt).not.toBeNull();
    expect(s(950_000)).toBe(185);
  });

  test("completion logs every exercise once per minute, the work not the rest, and no PRs", () => {
    const progress = newWodProgress();
    advanceProgress(progress, steps, lead + 1200);
    const session = recordedSession(cfg, steps, progress, start, false);
    expect(progress.duration).toBe(1200);
    const by = new Map(session.entries.map((e) => [exById.get(e.exerciseId)!.name, e.sets.map((x) => [x.seconds, x.reps ?? null])]));
    expect(by.get("Run on the Spot")).toEqual([[40, null]]);
    // A finished minute logs its prescribed reps; a timed one its seconds of work.
    expect(by.get("Burpee")).toEqual([[60, 8], [60, 10], [60, 12]]);
    expect(by.get("High Knees")).toEqual([[35, null], [38, null], [40, null]]);
    expect(by.get("Dead Bug")).toEqual([[60, 10], [60, 13], [60, 16]]);
    // Prescribed, not counted: unchecked, so no record is minted from them.
    expect(session.entries.flatMap((e) => e.sets).every((x) => !x.done)).toBe(true);
    expect(session.templateId).toBe("tpl-full-body-emom-20");
    expect(session.note).toContain("Finished");
    expect(session.note).toContain("2:00 warm-up + 3 rounds of 6 stations EMOM");
    expect(recomputePRs([session], exercises, [])).toEqual([]);
  });

  test("stopping mid-minute logs only what was done", () => {
    const progress = newWodProgress();
    advanceProgress(progress, steps, lead + 120 + 15);
    const session = recordedSession(cfg, steps, progress, start, true);
    expect(session.entries.map((e) => exById.get(e.exerciseId)!.name)).toEqual(["Run on the Spot", "Arm Circles", "Air Squat", "Burpee"]);
    expect(session.entries[3]!.sets[0]!.seconds).toBe(15);
    expect(session.entries[3]!.sets[0]!.reps).toBeUndefined(); // a minute cut short claims no reps
    expect(session.note).toContain("Stopped early");
  });

  test("the plan is the configuration: rounds, warm-up, reps and durations follow it", () => {
    const plan = tpl.emom!;
    const variant: Template = {
      ...tpl,
      emom: {
        ...plan,
        rounds: 2,
        warmup: undefined,
        stations: plan.stations.map((st) => (st.seconds ? { ...st, seconds: [20, 30] } : { ...st, reps: [6, 8] })),
      },
    };
    const v = cfgOf(variant);
    const vs = buildSteps(v);
    expect(vs.reduce((a, st) => a + st.secs, 0) - vs[0]!.secs).toBe(720);
    expect(templateLength(variant)).toEqual({ seconds: 720, exact: true });
    expect(vs[1]!.exercise!.name).toBe("Burpee"); // no warm-up: the first minute follows the lead-in
    expect(vs.filter((st) => st.emom?.block === "warmup")).toHaveLength(0);
    expect(vs.filter((st) => st.emom?.block === "station")).toHaveLength(12);
    expect(vs.filter((st) => st.exercise?.name === "High Knees").map((st) => st.emom!.workSecs)).toEqual([20, 30]);
    expect(vs.filter((st) => st.emom?.block === "station" && st.exercise?.name === "Burpee").map((st) => st.emom!.target)).toEqual(["6 reps", "8 reps"]);
  });

  test("a station without a count for every round refuses to start", () => {
    const plan = tpl.emom!;
    const short: Template = { ...tpl, emom: { ...plan, stations: plan.stations.map((st, i) => (i === 0 ? { ...st, reps: [8, 10] } : st)) } };
    expect(configForTemplate(short, exById)).toContain("Burpee has no count for every one of its 3 rounds");
  });

  test("a missing exercise refuses to start instead of running a short EMOM", () => {
    const partial = new Map(exById);
    partial.delete(EX_DEAD_BUG);
    expect(typeof configForTemplate(tpl, partial)).toBe("string");
  });

  test("the voice names the next minute's exercise as each rest begins", () => {
    const burpeeIdx = steps.findIndex((st) => st.exercise?.name === "Burpee");
    expect(cueLine(steps[0]!)).toBe("First: Run on the Spot");
    expect(restLine(steps, burpeeIdx)).toBe("Next: Reverse Lunge");
    expect(restLine(steps, 1)).toBe(""); // warm-up has no rest
    expect(restLine(steps, steps.length - 1)).toBe(""); // nothing after the last minute
    const lines = new Set(allVoiceLines().map((l) => `${l.role}|${l.text}`));
    expect(lines.has("workout|Next: Band or Backpack Row")).toBe(true);
  });
});

describe("Kettlebell EMOM - 20 Minutes", () => {
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  const tpl = seedTemplates().find((t) => t.id === "tpl-kettlebell-emom-20")!;
  const cfg = configForTemplate(tpl, exById) as WodConfig;
  const steps = buildSteps(cfg);

  test("20:00 after the lead-in: the same warm-up, then three rounds of six bell minutes", () => {
    expect(steps.reduce((a, st) => a + st.secs, 0) - steps[0]!.secs).toBe(1200);
    expect(templateLength(tpl)).toEqual({ seconds: 1200, exact: true });
    const stations = steps.filter((st) => st.emom?.block === "station");
    expect(stations).toHaveLength(18);
    expect(tpl.emom!.stations.map((st) => [exById.get(st.exerciseId)!.name, emomRoundsTarget(st)])).toEqual([
      ["Kettlebell Swing", "15 · 18 · 20 reps"],
      ["Goblet Squat", "10 · 11 · 12 reps"],
      ["Kettlebell Clean & Press", "10 reps · 5 per arm"],
      ["High Knees", "35 · 38 · 40 s"],
      ["Single-Arm Kettlebell Row", "16 reps · 8 per arm"],
      ["Dead Bug", "10 · 13 · 16 reps"],
    ]);
    expect(stations[0]!.emom!.target).toBe("15 reps");
    expect(stations.map((st) => st.at - steps[0]!.secs)).toEqual(stations.map((_, i) => 120 + i * 60));
  });
});
