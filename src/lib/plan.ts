/**
 * What a template's plan implies, computed rather than stored: the
 * exercises it uses and, for the guided kinds, the scheme the card shows.
 * Storing them too was how a scheme could say "12 stations" over eleven.
 */
import type { Plan, PlanKind, Template } from "../types";

/** The indoor bike: the one exercise every ride runs (EX.spinBike). */
export const SPIN_BIKE = "ex-spin-bike";

/** Every exercise the plan runs, in order, repeats kept (interval stations repeat). */
export function planExercises(plan: Plan): string[] {
  switch (plan.kind) {
    case "interval":
      return plan.stations;
    case "emom":
      return [...(plan.warmup ?? []).map((w) => w.exerciseId), ...plan.stations.map((s) => s.exerciseId)];
    case "flow":
      return plan.steps.map((s) => s.exerciseId);
    case "forTime":
      return plan.stages.map((s) => s.exerciseId);
    case "ride":
      return [SPIN_BIKE];
    case "logged":
      return plan.exercises;
  }
}

/** The template's exercises, each once, in the order they first come up. */
export function templateExerciseIds(t: Template): string[] {
  return [...new Set(planExercises(t.plan))];
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

/** Clock time of an interval plan: every station each round, a rest between, none after the last. */
export function intervalSeconds(p: { stations: readonly unknown[]; work: number; rest: number; rounds: number }): number {
  const steps = p.stations.length * p.rounds;
  return steps * p.work + Math.max(0, steps - 1) * p.rest;
}

/** Clock time of a flow: every hold, plus the moves between poses. */
export function flowSeconds(p: { steps: readonly { seconds: number }[]; transition: number }): number {
  return p.steps.reduce((sum, s) => sum + s.seconds, 0) + Math.max(0, p.steps.length - 1) * p.transition;
}

/** Seconds of an EMOM's warm-up. */
export function emomWarmupSeconds(p: { warmup?: readonly { seconds: number }[] | undefined }): number {
  return (p.warmup ?? []).reduce((sum, w) => sum + w.seconds, 0);
}

/** Clock time of an EMOM: the warm-up, then every station's whole minute, every round. */
export function emomSeconds(p: { minute: number; rounds: number; stations: readonly unknown[]; warmup?: readonly { seconds: number }[] | undefined }): number {
  return emomWarmupSeconds(p) + p.rounds * p.stations.length * p.minute;
}

const withNote = (core: string, note: string | undefined) => (note === undefined ? core : `${core} · ${note}`);

/**
 * The prescription line on the card. Interval, EMOM and flow plans have it
 * computed from their numbers, so it always says what the player runs; the
 * others carry their own (a for-time scheme names loads and distances).
 */
export function schemeOf(plan: Plan): string {
  switch (plan.kind) {
    case "interval": {
      const n = plan.stations.length;
      const rest = plan.rest > 0 ? ` / ${plan.rest} s rest` : ", no rest";
      return withNote(`${plan.rounds} ${plan.rounds === 1 ? "round" : "rounds"} · ${n} ${n === 1 ? "station" : "stations"} · ${plan.work} s work${rest}`, plan.note);
    }
    case "emom": {
      const warm = emomWarmupSeconds(plan);
      const main = plan.rounds * plan.stations.length * plan.minute;
      const parts = [
        clock(warm + main),
        ...(warm > 0 ? [`${clock(warm)} warm-up`] : []),
        `${clock(main)} EMOM`,
        `${plan.rounds} ${plan.rounds === 1 ? "round" : "rounds"}`,
        `${plan.stations.length} ${plan.stations.length === 1 ? "station" : "stations"}`,
      ];
      return withNote(parts.join(" · "), plan.note);
    }
    case "flow": {
      const holds = plan.steps.map((s) => s.seconds);
      const lo = Math.min(...holds), hi = Math.max(...holds);
      const parts = [
        `${clock(flowSeconds(plan))} flow`,
        `${plan.steps.length} ${plan.steps.length === 1 ? "pose" : "poses"}`,
        lo === hi ? `holds of ${lo} s` : `holds of ${lo}–${hi} s`,
        ...(plan.transition > 0 ? [`${plan.transition} s to move between poses`] : []),
      ];
      return withNote(parts.join(" · "), plan.note);
    }
    case "forTime":
    case "ride":
    case "logged":
      return plan.scheme;
  }
}

/** The library's filter categories: an EMOM files under Intervals. */
export type LibraryKind = "interval" | "flow" | "forTime" | "ride" | "logged";

export function libraryKind(kind: PlanKind): LibraryKind {
  return kind === "emom" ? "interval" : kind;
}

/** Plans the guided player runs: steps on a clock, spoken cues. */
export function isGuided(plan: Plan): plan is Extract<Plan, { kind: "interval" | "emom" | "flow" }> {
  return plan.kind === "interval" || plan.kind === "emom" || plan.kind === "flow";
}

/* Each kind's plan, or undefined: `const ride = rideOf(t); if (ride) …`. */
export const intervalOf = (t: Pick<Template, "plan">): Extract<Plan, { kind: "interval" }> | undefined => (t.plan.kind === "interval" ? t.plan : undefined);
export const emomOf = (t: Pick<Template, "plan">): Extract<Plan, { kind: "emom" }> | undefined => (t.plan.kind === "emom" ? t.plan : undefined);
export const flowOf = (t: Pick<Template, "plan">): Extract<Plan, { kind: "flow" }> | undefined => (t.plan.kind === "flow" ? t.plan : undefined);
export const forTimeOf = (t: Pick<Template, "plan">): Extract<Plan, { kind: "forTime" }> | undefined => (t.plan.kind === "forTime" ? t.plan : undefined);
export const rideOf = (t: Pick<Template, "plan">): Extract<Plan, { kind: "ride" }> | undefined => (t.plan.kind === "ride" ? t.plan : undefined);
