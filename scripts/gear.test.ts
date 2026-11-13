import { describe, expect, test } from "bun:test";
import { seedTemplates } from "../src/lib/seed";
import { exerciseGear } from "../src/lib/library";
import { templateGear } from "../src/lib/gear";

const kit = (id: string) => {
  const tpl = seedTemplates().find((t) => t.id === id);
  if (!tpl) throw new Error(`no template ${id}`);
  return templateGear(tpl, exerciseGear).map((g) => (g.detail ? `${g.label} · ${g.detail}` : g.label));
};

describe("workout kit lists", () => {
  test("derived from the exercises the workout runs, in catalogue order", () => {
    // Bench dips are one station of twelve: the bench must still be on the list.
    expect(kit("tpl-varg-18")).toEqual(["Bench", "Mat"]);
    expect(kit("tpl-full-body-emom-20")).toEqual(["Band or loaded backpack", "Jump rope", "Mat"]);
    expect(kit("tpl-varg-yoga-10")).toEqual(["Mat"]);
  });

  test("a template qualifies its gear and adds what no exercise implies", () => {
    expect(kit("tpl-kettlebell-emom-20")).toEqual(["Kettlebell · 12–24 kg", "Jump rope", "Mat"]);
    expect(kit("tpl-helen")).toEqual(["Kettlebell · 24/16 kg", "Pull-up bar"]);
    expect(kit("tpl-murph")).toEqual(["Pull-up bar", "Weight vest · 9 kg · traditional"]);
    expect(kit("tpl-chad")).toEqual(["Box or sturdy step · 50 cm", "Rucksack · 20/16 kg"]);
  });

  test("a heart-rate ride lists the strap it cannot start without", () => {
    expect(kit("tpl-ride-z2-40")).toEqual(["Indoor bike", "Heart-rate strap"]);
    expect(kit("tpl-ride-tabata")).toEqual(["Indoor bike"]);
  });

  test("bodyweight workouts list nothing", () => {
    const empty = seedTemplates().filter((t) => templateGear(t, exerciseGear).length === 0).map((t) => t.id);
    expect(empty).toContain("tpl-navy-prt");
  });
});
