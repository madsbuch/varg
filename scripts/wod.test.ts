import { describe, expect, test } from "bun:test";
import { advanceProgress, buildSteps, newWodProgress, recordedEntries, recordedSession } from "../src/lib/wod";
import type { WodConfig } from "../src/lib/wod";
import { recomputePRs } from "../src/lib/prs";
import { seedExercises } from "../src/lib/seed";

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
