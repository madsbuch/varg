import { describe, expect, test } from "bun:test";
import { advanceProgress, buildSteps, configForTemplate, newWodProgress, recordedEntries, recordedSession } from "../src/lib/wod";
import type { WodConfig } from "../src/lib/wod";
import { recomputePRs } from "../src/lib/prs";
import { seedExercises, seedTemplates } from "../src/lib/seed";
import { allVoiceLines, cueLine } from "../src/lib/voice-clips";

const exercises = seedExercises();
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
      for (const step of buildSteps(cfg)) {
        const line = cueLine(step);
        if (!line) continue;
        spoken++;
        expect(lines.has(`${cfg.voice!}|${line}`)).toBe(true);
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
