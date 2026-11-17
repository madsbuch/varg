/**
 * Mímir's programs: the model's JSON is read by a strict schema, the schemes
 * the guided players compute are the app's own arithmetic, and nothing that
 * breaks a template rule can reach Save.
 */
import { describe, expect, test } from "bun:test";
import { EX, seedExercises, seedTemplates } from "../src/lib/seed";
import { readProgram } from "../src/lib/mimir";
import { templateProblems } from "../src/lib/template-check";
import { templateLength } from "../src/lib/catalog";
import { schemeOf, templateExerciseIds } from "../src/lib/plan";
import type { Template } from "../src/types";
import { must } from "./must";

const exercises = seedExercises().filter((e) => e.deprecated !== true);
const check = (raw: unknown): { template?: Template; problems: string[] } => {
  const r = readProgram(raw, "mimir-test");
  return r.template ? { template: r.template, problems: templateProblems(r.template, exercises) } : r;
};

describe("reading a program", () => {
  test("an interval circuit runs as asked, its scheme computed", () => {
    const r = check({
      name: "Wolf Circuit",
      description: "Sit-ups, cardio, push-ups.",
      level: "beginner",
      plan: { kind: "interval", stations: [EX.sitUp, EX.runInPlace, EX.pushUp], work: 20, rest: 10, rounds: 3 },
    });
    expect(r.problems).toEqual([]);
    const t = must(r.template);
    expect(schemeOf(t.plan)).toBe("3 rounds · 3 stations · 20 s work / 10 s rest");
    expect(t.branch).toBe("Mímir");
    expect(templateLength(t)).toEqual({ seconds: 9 * 20 + 8 * 10, exact: true });
  });

  test("an EMOM states its real total, and its exercises come from its plan", () => {
    const r = check({
      name: "Short EMOM",
      description: "Burpees and squats.",
      level: "intermediate",
      plan: {
        kind: "emom",
        minute: 60,
        rounds: 2,
        warmup: [{ exerciseId: EX.runInPlace, seconds: 60 }],
        stations: [{ exerciseId: EX.burpee, reps: [8, 10] }, { exerciseId: EX.airSquat, reps: [20, 20] }],
        note: "keep moving",
      },
    });
    expect(r.problems).toEqual([]);
    const t = must(r.template);
    expect(schemeOf(t.plan)).toBe("5:00 · 1:00 warm-up · 4:00 EMOM · 2 rounds · 2 stations · keep moving");
    expect(templateExerciseIds(t)).toEqual([EX.runInPlace, EX.burpee, EX.airSquat]);
  });

  test("unknown exercises never pass", () => {
    const r = check({ name: "X", description: "x", level: "beginner", plan: { kind: "interval", stations: ["ex-moon-walk"], work: 20, rest: 10, rounds: 1 } });
    expect(r.problems.join()).toContain("unknown exercises: ex-moon-walk");
  });

  test("an EMOM range or a reps count on a timed exercise is refused", () => {
    const r = check({
      name: "Bad EMOM",
      description: "x",
      level: "beginner",
      plan: { kind: "emom", minute: 60, rounds: 2, stations: [{ exerciseId: EX.burpee, reps: [8] }, { exerciseId: EX.plank, reps: [10, 10] }] },
    });
    expect(r.problems.some((p) => p.includes("1 counts for 2 rounds"))).toBe(true);
    expect(r.problems.some((p) => p.includes("not counted in reps"))).toBe(true);
  });

  test("a for-time label must state what it logs", () => {
    const r = check({
      name: "Hundreds",
      description: "x",
      level: "advanced",
      plan: { kind: "forTime", stages: [{ exerciseId: EX.pushUp, label: "Push-ups", reps: 100 }], scheme: "100 push-ups · for time", estimateMinutes: 15 },
    });
    expect(r.problems.join()).toContain("does not state the 100 reps");
  });

  test("a logged session needs its typical length", () => {
    const r = check({ name: "Heavy Day", description: "x", level: "advanced", plan: { kind: "logged", exercises: [EX.backSquat], scheme: "5 × 5" } });
    expect(r.problems.join()).toContain("program.plan.estimateMinutes");
  });

  test("wrong types are named with their path, never coerced", () => {
    const r = readProgram({ name: "X", description: "x", level: "expert", plan: { kind: "interval", stations: [EX.pushUp], work: "20", rest: 10, rounds: 3 } }, "mimir-x");
    expect(r.template).toBeUndefined();
    expect(r.problems.some((p) => p.startsWith("program.level:"))).toBe(true);
    expect(r.problems.some((p) => p.startsWith("program.plan.work:"))).toBe(true);
  });

  test("unknown fields are refused: a scheme on an interval, a second plan", () => {
    const r = readProgram({ name: "X", description: "x", level: "beginner", plan: { kind: "interval", stations: [EX.pushUp], work: 20, rest: 10, rounds: 3, scheme: "made up" } }, "mimir-x");
    expect(r.problems.join()).toContain("scheme");
    const two = readProgram({ name: "X", description: "x", level: "beginner", plan: { kind: "flow", steps: [], transition: 5 }, interval: {} }, "mimir-x");
    expect(two.problems.join()).toContain("interval");
  });
});

describe("the shared rules still bite the built-ins", () => {
  test("every built-in passes", () => {
    for (const t of seedTemplates()) expect(templateProblems(t, seedExercises())).toEqual([]);
  });
  test("a built-in broken on purpose fails", () => {
    const t = must(seedTemplates().find((x) => x.plan.kind === "interval"));
    if (t.plan.kind !== "interval") throw new Error("not an interval");
    expect(templateProblems({ ...t, plan: { ...t.plan, note: "400 m run" } }, seedExercises()).join()).toContain("prescribes a distance");
  });
});
