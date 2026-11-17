/**
 * Mímir's programs: the model's JSON is read strictly, the schemes the
 * guided players compute are written by the app (never the model's
 * arithmetic), and nothing that breaks a template rule can reach Save.
 */
import { describe, expect, test } from "bun:test";
import { EX, seedExercises, seedTemplates } from "../src/lib/seed";
import { readProgram } from "../src/lib/mimir";
import { templateProblems } from "../src/lib/template-check";
import { templateLength } from "../src/lib/catalog";

const exercises = seedExercises().filter((e) => !e.deprecated);
const check = (raw: unknown) => {
  const r = readProgram(raw, "mimir-test");
  return r.template ? { template: r.template, problems: templateProblems(r.template, exercises) } : r;
};

describe("reading a program", () => {
  test("an interval circuit runs as asked, scheme written by the app", () => {
    const r = check({
      name: "Wolf Circuit",
      description: "Sit-ups, cardio, push-ups.",
      level: "beginner",
      exerciseIds: [EX.sitUp, EX.runInPlace, EX.pushUp],
      interval: { work: 20, rest: 10, rounds: 3 },
      scheme: "something the model made up · 9 burpees",
    });
    expect(r.problems).toEqual([]);
    expect(r.template?.scheme).toBe("3 rounds · 3 stations · 20 s work / 10 s rest");
    expect(r.template?.branch).toBe("Mímir");
    expect(r.template && templateLength(r.template)).toEqual({ seconds: 9 * 20 + 8 * 10, exact: true });
  });

  test("an EMOM states its real total", () => {
    const r = check({
      name: "Short EMOM",
      description: "Burpees and squats.",
      level: "intermediate",
      emom: {
        rounds: 2,
        warmup: [{ exerciseId: EX.runInPlace, seconds: 60 }],
        stations: [{ exerciseId: EX.burpee, reps: [8, 10] }, { exerciseId: EX.airSquat, reps: [20, 20] }],
      },
    });
    expect(r.problems).toEqual([]);
    expect(r.template?.scheme).toBe("5:00 · 1:00 warm-up · 4:00 EMOM · 2 rounds · 2 stations");
    expect(r.template?.exerciseIds).toEqual([EX.runInPlace, EX.burpee, EX.airSquat]);
  });

  test("unknown exercises never pass", () => {
    const r = check({ name: "X", description: "x", level: "beginner", exerciseIds: ["ex-moon-walk"], interval: { work: 20, rest: 10, rounds: 1 } });
    expect(r.problems.join()).toContain("unknown exercises: ex-moon-walk");
  });

  test("an EMOM range or a reps count on a timed exercise is refused", () => {
    const r = check({
      name: "Bad EMOM",
      description: "x",
      level: "beginner",
      emom: { rounds: 2, stations: [{ exerciseId: EX.burpee, reps: [8] }, { exerciseId: EX.plank, reps: [10, 10] }] },
    });
    expect(r.problems.some((p) => p.includes("1 counts for 2 rounds"))).toBe(true);
    expect(r.problems.some((p) => p.includes("not counted in reps"))).toBe(true);
  });

  test("a for-time label must state what it logs", () => {
    const r = check({
      name: "Hundreds",
      description: "x",
      level: "advanced",
      estimateMinutes: 15,
      scheme: "100 push-ups · for time",
      forTime: { stages: [{ exerciseId: EX.pushUp, label: "Push-ups", reps: 100 }] },
    });
    expect(r.problems.join()).toContain("does not state the 100 reps");
  });

  test("a logged session needs its typical length", () => {
    const r = check({ name: "Heavy Day", description: "x", level: "advanced", scheme: "5 × 5", exerciseIds: [EX.backSquat] });
    expect(r.problems.join()).toContain("needs estimateMinutes");
  });

  test("wrong types are named, not coerced", () => {
    const r = readProgram({ name: "X", description: "x", level: "expert", exerciseIds: [EX.pushUp], interval: { work: "20", rest: 10, rounds: 3 } }, "mimir-x");
    expect(r.template).toBeUndefined();
    expect(r.problems).toContain("interval.work must be a whole number");
    expect(r.problems).toContain('level must be one of "beginner", "intermediate", "advanced"');
  });

  test("only one player", () => {
    const r = readProgram({ name: "X", description: "x", level: "beginner", exerciseIds: [EX.pushUp], interval: {}, flow: {} }, "mimir-x");
    expect(r.problems.join()).toContain("set only one of");
  });
});

describe("the shared rules still bite the built-ins", () => {
  test("every built-in passes", () => {
    for (const t of seedTemplates()) expect(templateProblems(t, seedExercises())).toEqual([]);
  });
  test("a built-in broken on purpose fails", () => {
    const t = seedTemplates().find((x) => x.interval);
    if (!t) throw new Error("no interval built-in");
    expect(templateProblems({ ...t, scheme: `${t.scheme} · 400 m run` }, seedExercises()).join()).toContain("prescribes a distance");
  });
});
