import { describe, expect, test } from "bun:test";
import {
  bestForTime,
  finishedTime,
  recordedForTimeSession,
  splitsFrom,
} from "../src/lib/fortime";
import type { ForTimeConfig } from "../src/lib/fortime";
import { recomputePRs } from "../src/lib/prs";
import { seedExercises, seedTemplates } from "../src/lib/seed";

const exercises = seedExercises();
const murph = seedTemplates().find((t) => t.id === "tpl-murph")!;
const stages = murph.forTime!.stages;
const byId = new Map(exercises.map((e) => [e.id, e]));
const config: ForTimeConfig = {
  title: murph.name,
  templateId: murph.id,
  stages,
  exercises: stages.map((s) => byId.get(s.exerciseId)!),
};
const start = "2026-11-07T08:00:00.000Z";
// Cumulative clock readings at each Done: 8:00, 20:00, 32:00, 42:00, 50:00.
const marks = [480, 1200, 1920, 2520, 3000];

describe("for-time recording", () => {
  test("splits are the gaps between Done taps", () => {
    expect(splitsFrom(marks)).toEqual([480, 720, 720, 600, 480]);
    expect(splitsFrom([])).toEqual([]);
  });

  test("a finished run logs one unchecked set per stage, grouped by exercise", () => {
    const s = recordedForTimeSession(config, marks, start);
    expect(s.templateId).toBe("tpl-murph");
    expect(s.date).toBe(start);
    // Run appears twice in Murph: one entry, two sets, in stage order.
    const run = s.entries.find((e) => e.exerciseId === stages[0]!.exerciseId)!;
    expect(run.sets.map((x) => [x.meters, x.seconds])).toEqual([[1600, 480], [1600, 480]]);
    const pull = s.entries.find((e) => e.exerciseId === stages[1]!.exerciseId)!;
    expect(pull.sets.map((x) => [x.reps, x.seconds])).toEqual([[100, 720]]);
    expect(s.entries.flatMap((e) => e.sets).every((x) => !x.done)).toBe(true);
    expect(s.note).toContain("50:00");
  });

  test("Murph's 100 pull-ups are never filed as a 100-rep max", () => {
    const s = recordedForTimeSession(config, marks, start);
    expect(recomputePRs([s], exercises, [])).toEqual([]);
  });

  test("finished time and best time come from completed runs only", () => {
    const fast = recordedForTimeSession(config, marks.map((m) => m - 60), "2026-11-01T08:00:00.000Z");
    const slow = recordedForTimeSession(config, marks, start);
    const partial = recordedForTimeSession(config, [100, 200], "2026-11-02T08:00:00.000Z", 250);
    expect(finishedTime(slow, stages.length)).toBe(3000);
    expect(finishedTime(fast, stages.length)).toBe(2940);
    expect(finishedTime(partial, stages.length)).toBeUndefined();
    expect(partial.note).toContain("stopped early");
    expect(bestForTime([slow, fast, partial], murph.id, stages.length)).toBe(2940);
    // "Previous best" leaves out the run just logged.
    expect(bestForTime([slow, fast], murph.id, stages.length, fast.date)).toBe(3000);
    expect(bestForTime([partial], murph.id, stages.length)).toBeUndefined();
  });

  test("an old Murph logged by hand is not read as a for-time result", () => {
    const manual = recordedForTimeSession(config, marks, start);
    manual.note = murph.scheme; // what the set-logger path writes
    expect(finishedTime(manual, stages.length)).toBeUndefined();
  });
});
