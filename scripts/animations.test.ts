import { describe, expect, test } from "bun:test";
import { bakeMotion, distance, MOTIONS, sampleScene, skeleton, solveLimb } from "../src/lib/exercise-motion";
import type { AnimKey, Point } from "../src/lib/exercise-motion";
import { seedExercises, EX } from "../src/lib/seed";
import { libraryFor } from "../src/lib/library";

const keys = Object.keys(MOTIONS) as AnimKey[];
const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const near = (a: Point, b: Point, tolerance = 0.001) => expect(distance(a, b)).toBeLessThan(tolerance);

describe("exercise motion geometry", () => {
  for (const key of keys) {
    test(`${key}: connected fixed-length limbs, reachable targets, seamless SVG tracks`, () => {
      const frames = bakeMotion(key);
      const first = frames[0]!;
      const last = frames.at(-1)!;
      for (const [i, scene] of frames.entries()) {
        const rig = skeleton(scene.pose);
        for (let side = 0; side < 2; side++) {
          const arm = rig.arms[side]!;
          expect(distance(arm[0], arm[1])).toBeCloseTo(12, 5);
          expect(distance(arm[1], arm[2])).toBeCloseTo(12, 5);
          near(arm[0], rig.shoulder);
          near(arm[2], scene.pose.hands[side]!);
          // 90/90 is projected into the floor plane; check physical lengths
          // before the camera foreshortens depth.
          const leg = solveLimb(scene.pose.hip, scene.pose.feet[side]!, 17, scene.pose.knees[side]!);
          expect(distance(leg[0], leg[1])).toBeCloseTo(17, 5);
          expect(distance(leg[1], leg[2])).toBeCloseTo(17, 5);
          near(leg[2], scene.pose.feet[side]!);
        }
        expect(distance(rig.hip, rig.shoulder)).toBeCloseTo(23, 5);
        expect(scene.shapes.length).toBe(first.shapes.length);
        expect(scene.balls.length).toBe(first.balls.length);
        scene.shapes.forEach((part, j) => {
          expect(part.d.replace(/[-\d.]+/g, "")).toBe(first.shapes[j]!.d.replace(/[-\d.]+/g, ""));
          expect(numbers(part.d).every(Number.isFinite)).toBe(true);
          expect(part.opacity ?? 1).toBeGreaterThanOrEqual(0);
          expect(part.opacity ?? 1).toBeLessThanOrEqual(1);
        });
        for (const point of [...rig.arms.flat(), ...rig.legs.flat(), rig.head]) {
          expect(point[0]).toBeGreaterThanOrEqual(2);
          expect(point[0]).toBeLessThanOrEqual(98);
          expect(point[1]).toBeGreaterThanOrEqual(2);
          expect(point[1]).toBeLessThanOrEqual(98);
        }
        for (const b of scene.balls) {
          if ((b.opacity ?? 1) < 0.01) continue;
          expect(b.center[0] - b.radius).toBeGreaterThanOrEqual(0);
          expect(b.center[0] + b.radius).toBeLessThanOrEqual(100);
          expect(b.center[1] - b.radius).toBeGreaterThanOrEqual(0);
          expect(b.center[1] + b.radius).toBeLessThanOrEqual(100);
        }
        if (i === frames.length - 1) {
          first.shapes.forEach((p, j) => {
            numbers(p.d).forEach((v, n) => expect(Math.abs(v - numbers(last.shapes[j]!.d)[n]!)).toBeLessThan(0.01));
          });
          first.balls.forEach((b, j) => near(b.center, last.balls[j]!.center, 0.01));
        }
      }
    });
    test(`${key}: no elbow or knee branch flips between keyframes`, () => {
      let previous = numbers(sampleScene(key, 0).shapes.slice(0, 6).map(p => p.d).join(" "));
      const steps = Math.ceil(MOTIONS[key].dur * 1000); // one millisecond, even for the five-stage shuttle
      for (let step = 1; step <= steps; step++) {
        const current = numbers(sampleScene(key, step / steps).shapes.slice(0, 6).map(p => p.d).join(" "));
        expect(Math.max(...current.map((v, i) => Math.abs(v - previous[i]!)))).toBeLessThan(1.5);
        previous = current;
      }
    });
  }

  test("push-ups and Down Dog/Cobra keep contacts planted and legs straight", () => {
    for (const key of ["pushup", "downDogCobra"] as const) {
      const start = skeleton(sampleScene(key, 0).pose);
      for (let i = 0; i <= 100; i++) {
        const rig = skeleton(sampleScene(key, i / 100).pose);
        near(rig.arms[1][2], start.arms[1][2]);
        near(rig.legs[1]![2]!, start.legs[1]![2]!);
        expect(distance(rig.hip, rig.legs[1]![2]!)).toBeCloseTo(34, 4);
      }
    }
  });

  test("kneeling mobility keeps the rear knee grounded", () => {
    for (const key of ["ankleRock", "hipFlexorStretch"] as const) {
      for (let i = 0; i <= 100; i++) {
        const knee = skeleton(sampleScene(key, i / 100).pose).legs[0]![1]!;
        expect(knee[1]).toBeGreaterThan(87.5);
        expect(knee[1]).toBeLessThanOrEqual(88.001);
      }
    }
  });

  test("burpee includes chest-down and airborne phases", () => {
    expect(skeleton(sampleScene("burpee", 0.39).pose).shoulder[1]).toBeGreaterThan(80);
    expect(skeleton(sampleScene("burpee", 0.87).pose).legs[1]![2]![1]).toBeLessThan(80);
    expect(skeleton(sampleScene("burpee", 0.87).pose).arms[1][2][1]).toBeLessThan(10);
  });

  test("box step-up keeps its leading foot fixed on the box", () => {
    for (let i = 0; i <= 100; i++) near(skeleton(sampleScene("boxStepUp", i / 100).pose).legs[1]![2]!, [69, 68]);
  });

  test("box jump steps off the edge instead of passing through the box", () => {
    for (let i = 0; i <= 500; i++) {
      for (const leg of skeleton(sampleScene("jump", i / 500).pose).legs) {
        const foot = leg[2]!;
        if (foot[0] > 62.001 && foot[0] < 88) expect(foot[1]).toBeLessThanOrEqual(68.001);
      }
    }
  });

  test("native interpolation between baked frames preserves apparent limb length", () => {
    for (const key of keys) {
      const frames = bakeMotion(key);
      for (let i = 1; i < frames.length; i++) {
        const a = skeleton(frames[i - 1]!.pose), b = skeleton(frames[i]!.pose);
        const chains = [a.arms, b.arms];
        for (let side = 0; side < 2; side++) {
          const midpoint = chains[0]![side]!.map((p, j) => [(p[0] + chains[1]![side]![j]![0]) / 2, (p[1] + chains[1]![side]![j]![1]) / 2] as Point);
          expect(Math.abs(distance(midpoint[0]!, midpoint[1]!) - 12)).toBeLessThan(0.25);
          expect(Math.abs(distance(midpoint[1]!, midpoint[2]!) - 12)).toBeLessThan(0.25);
        }
      }
    }
  });

  test("ball release separates from the hands and resets while invisible", () => {
    for (const key of ["powerThrow", "wallBall"] as const) {
      const scene = sampleScene(key, key === "powerThrow" ? 0.62 : 0.745);
      expect(distance(scene.balls[1]!.center, skeleton(scene.pose).arms[1][2])).toBeGreaterThan(15);
    }
    expect(sampleScene("powerThrow", 0.8).balls[1]!.opacity).toBe(0);
  });

  test("built-ins resolve to motion definitions with distinct lifts and equipment", () => {
    for (const ex of seedExercises()) expect(libraryFor(ex).anim in MOTIONS).toBe(true);
    const anim = (id: string) => libraryFor(seedExercises().find(e => e.id === id)!).anim;
    expect(anim(EX.powerClean)).not.toBe(anim(EX.deadlift));
    expect(anim(EX.frontSquat)).not.toBe(anim(EX.backSquat));
    expect(anim(EX.wallBall)).not.toBe(anim(EX.thruster));
    expect(sampleScene(anim(EX.wallBall), 0).balls.length).toBe(2);
  });
});
