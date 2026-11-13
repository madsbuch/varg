/**
 * What a workout needs to hand before it starts: the kit list on its card.
 *
 * Every built-in exercise declares its own gear in library.ts (an empty
 * list is a declaration too: bodyweight). A template's list is derived
 * from the exercises it actually runs, so a new workout gets a correct
 * list without anyone writing one, and cannot forget the bench its bench
 * dips need. A template adds only what no exercise implies (Murph's vest)
 * and the specifics of its own prescription (Helen's 24/16 kg bell) in
 * `Template.gear`; db:smoke rejects a detail for gear the workout does
 * not use.
 */
import type { Template } from "../types";

/** The kit, in the order a card lists it: big and heavy first, mat last. */
export const GEAR = {
  spinBike: "Indoor bike",
  airBike: "Air bike",
  rower: "Rowing machine",
  chestStrap: "Heart-rate strap",
  barbell: "Barbell + plates",
  rack: "Squat rack",
  bench: "Bench",
  kettlebell: "Kettlebell",
  carryPair: "2 kettlebells or dumbbells",
  sled: "Sled",
  wallBall: "Wall ball",
  medBall: "Medicine ball",
  pullUpBar: "Pull-up bar",
  rings: "Rings or TRX",
  dipBars: "Dip bars",
  band: "Resistance band",
  bandOrPack: "Band or loaded backpack",
  box: "Box or sturdy step",
  jumpRope: "Jump rope",
  ruck: "Rucksack",
  vest: "Weight vest",
  mat: "Mat",
} as const;

export type GearId = keyof typeof GEAR;

export interface GearItem {
  id: GearId;
  label: string;
  /** The template's own specifics: "24/16 kg", "50 cm". */
  detail?: string | undefined;
}

/** Every exercise id a template runs, whichever player runs it. */
export function templateExerciseIds(t: Template): string[] {
  return [
    ...t.exerciseIds,
    ...(t.flow?.steps.map((s) => s.exerciseId) ?? []),
    ...(t.forTime?.stages.map((s) => s.exerciseId) ?? []),
    ...(t.emom?.warmup?.map((w) => w.exerciseId) ?? []),
    ...(t.emom?.stations.map((s) => s.exerciseId) ?? []),
  ];
}

/**
 * The kit list for a template, in GEAR order. `gearOf` is the exercise's
 * declared gear (library.ts); passed in so this module stays free of the
 * library's animation imports.
 */
export function templateGear(t: Template, gearOf: (exerciseId: string) => readonly GearId[]): GearItem[] {
  const ids = new Set<GearId>(templateExerciseIds(t).flatMap(gearOf));
  for (const id of t.gear?.extra ?? []) ids.add(id);
  // A ride steered by heart rate will not start without the strap.
  if (t.ride?.segments.some((s) => s.hrZone !== undefined)) ids.add("chestStrap");
  return (Object.keys(GEAR) as GearId[])
    .filter((id) => ids.has(id))
    .map((id) => ({ id, label: GEAR[id], detail: t.gear?.detail?.[id] }));
}
