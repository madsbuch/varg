/**
 * Facts about a template that the library filters and cards show: how long
 * it takes, and whether that length is exact or a typical estimate.
 */
import type { Level, Template } from "../types";
import { emomSeconds, flowSeconds, intervalSeconds } from "./plan";

export { emomSeconds, flowSeconds, intervalSeconds };
import { rideSeconds } from "./ride";

/**
 * How long a workout takes: exact for interval, flow and EMOM workouts and
 * timed rides, the authored typical time for everything else. Undefined
 * only for a ride with neither (check:content makes that a build failure).
 */
export function templateLength(t: Template): { seconds: number; exact: boolean } | undefined {
  const plan = t.plan;
  switch (plan.kind) {
    case "interval":
      return { seconds: intervalSeconds(plan), exact: true };
    case "flow":
      return { seconds: flowSeconds(plan), exact: true };
    case "emom":
      return { seconds: emomSeconds(plan), exact: true };
    case "ride": {
      const s = plan.free ? undefined : rideSeconds(plan.segments);
      if (s !== undefined) return { seconds: s, exact: true };
      return plan.estimateMinutes === undefined ? undefined : { seconds: plan.estimateMinutes * 60, exact: false };
    }
    case "forTime":
    case "logged":
      return { seconds: plan.estimateMinutes * 60, exact: false };
  }
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
