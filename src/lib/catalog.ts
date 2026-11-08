/**
 * Facts about a template that the library filters and cards show: how long
 * it takes, and whether that length is exact or a typical estimate.
 */
import type { Level, Template } from "../types";

/**
 * Clock time an interval prescription actually takes: every station once
 * per round, with a rest between them but none after the very last one.
 */
export function intervalSeconds(
  stations: number,
  { work, rest, rounds }: { work: number; rest: number; rounds: number },
): number {
  const steps = stations * rounds;
  return steps * work + Math.max(0, steps - 1) * rest;
}

/** Clock time of a flow: every hold, plus the moves between poses. */
export function flowSeconds(flow: { steps: { seconds: number }[]; transition: number }): number {
  return flow.steps.reduce((sum, s) => sum + s.seconds, 0) + Math.max(0, flow.steps.length - 1) * flow.transition;
}

/**
 * How long a workout takes: exact for interval and flow workouts, the
 * authored typical time for everything else. Undefined only for a template
 * missing its estimate — db:smoke makes that a build failure.
 */
export function templateLength(t: Template): { seconds: number; exact: boolean } | undefined {
  if (t.interval) return { seconds: intervalSeconds(t.exerciseIds.length, t.interval), exact: true };
  if (t.flow) return { seconds: flowSeconds(t.flow), exact: true };
  if (t.estimateMinutes) return { seconds: t.estimateMinutes * 60, exact: false };
  return undefined;
}

export const LEVEL_LABEL: Record<Level, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Length buckets for the library filter, in minutes: [from, up to and including). */
export const LENGTHS = [
  { id: "short", label: "≤ 15 min", from: 0, to: 15 },
  { id: "medium", label: "15–30 min", from: 15, to: 30 },
  { id: "long", label: "30–60 min", from: 30, to: 60 },
  { id: "epic", label: "60+ min", from: 60, to: Infinity },
] as const;
export type LengthId = (typeof LENGTHS)[number]["id"];

export function lengthBucket(t: Template): LengthId | undefined {
  const len = templateLength(t);
  if (!len) return undefined;
  // Round to whole minutes first, so 17:50 counts as 18 and 15:30 as 16.
  const minutes = Math.round(len.seconds / 60);
  return LENGTHS.find((b) => minutes > b.from && minutes <= b.to)?.id;
}
