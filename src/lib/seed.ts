import type { Exercise, Split, Template } from "../types";

// Stable IDs so built-in content can be referenced from splits & templates.
export const EX = {
  backSquat: "ex-back-squat",
  frontSquat: "ex-front-squat",
  deadlift: "ex-deadlift",
  benchPress: "ex-bench-press",
  overheadPress: "ex-overhead-press",
  barbellRow: "ex-barbell-row",
  powerClean: "ex-power-clean",
  pullUp: "ex-pull-up",
  chinUp: "ex-chin-up",
  pushUp: "ex-push-up",
  dip: "ex-dip",
  sitUp: "ex-sit-up",
  plank: "ex-plank",
  flutterKick: "ex-flutter-kick",
  lunge: "ex-lunge",
  burpee: "ex-burpee",
  boxJump: "ex-box-jump",
  kettlebellSwing: "ex-kb-swing",
  wallBall: "ex-wall-ball",
  thruster: "ex-thruster",
  run: "ex-run",
  ruck: "ex-ruck",
  row: "ex-row-erg",
  assaultBike: "ex-assault-bike",
  farmerCarry: "ex-farmer-carry",
  hangingLegRaise: "ex-hanging-leg-raise",
} as const;

export function seedExercises(): Exercise[] {
  const e = (
    id: string,
    name: string,
    category: Exercise["category"],
    metric: Exercise["metric"],
    muscles: string[],
  ): Exercise => ({ id, name, category, metric, muscles, builtIn: true });

  return [
    e(EX.backSquat, "Back Squat", "strength", "weight_reps", ["quads", "glutes"]),
    e(EX.frontSquat, "Front Squat", "strength", "weight_reps", ["quads", "core"]),
    e(EX.deadlift, "Deadlift", "strength", "weight_reps", ["posterior chain", "back"]),
    e(EX.benchPress, "Bench Press", "strength", "weight_reps", ["chest", "triceps"]),
    e(EX.overheadPress, "Overhead Press", "strength", "weight_reps", ["shoulders", "triceps"]),
    e(EX.barbellRow, "Barbell Row", "strength", "weight_reps", ["back", "biceps"]),
    e(EX.powerClean, "Power Clean", "strength", "weight_reps", ["full body"]),
    e(EX.thruster, "Thruster", "conditioning", "weight_reps", ["full body"]),
    e(EX.kettlebellSwing, "Kettlebell Swing", "conditioning", "weight_reps", ["posterior chain"]),
    e(EX.wallBall, "Wall Ball", "conditioning", "weight_reps", ["legs", "shoulders"]),
    e(EX.farmerCarry, "Farmer's Carry", "conditioning", "weight_reps", ["grip", "core"]),
    e(EX.pullUp, "Pull-up", "bodyweight", "reps", ["back", "biceps"]),
    e(EX.chinUp, "Chin-up", "bodyweight", "reps", ["back", "biceps"]),
    e(EX.pushUp, "Push-up", "bodyweight", "reps", ["chest", "triceps"]),
    e(EX.dip, "Dip", "bodyweight", "reps", ["chest", "triceps"]),
    e(EX.sitUp, "Sit-up", "core", "reps", ["core"]),
    e(EX.flutterKick, "Flutter Kick", "core", "reps", ["core"]),
    e(EX.hangingLegRaise, "Hanging Leg Raise", "core", "reps", ["core"]),
    e(EX.lunge, "Walking Lunge", "bodyweight", "reps", ["quads", "glutes"]),
    e(EX.burpee, "Burpee", "conditioning", "reps", ["full body"]),
    e(EX.boxJump, "Box Jump", "conditioning", "reps", ["legs"]),
    e(EX.plank, "Plank", "core", "time", ["core"]),
    e(EX.run, "Run", "cardio", "distance_time", ["conditioning"]),
    e(EX.ruck, "Ruck March", "ruck", "distance_time", ["conditioning", "legs"]),
    e(EX.row, "Row (Erg)", "cardio", "distance_time", ["conditioning"]),
    e(EX.assaultBike, "Assault Bike", "cardio", "distance_time", ["conditioning"]),
  ];
}

export function seedSplits(): Split[] {
  return [
    {
      id: "split-ppl",
      name: "Push / Pull / Legs",
      description: "Classic 3-day hypertrophy + strength rotation.",
      builtIn: true,
      days: [
        { id: "ppl-push", name: "Push", exerciseIds: [EX.benchPress, EX.overheadPress, EX.dip, EX.pushUp] },
        { id: "ppl-pull", name: "Pull", exerciseIds: [EX.deadlift, EX.barbellRow, EX.pullUp, EX.chinUp] },
        { id: "ppl-legs", name: "Legs", exerciseIds: [EX.backSquat, EX.frontSquat, EX.lunge, EX.boxJump] },
      ],
    },
    {
      id: "split-upper-lower",
      name: "Upper / Lower",
      description: "4-day strength split.",
      builtIn: true,
      days: [
        { id: "ul-upper", name: "Upper", exerciseIds: [EX.benchPress, EX.barbellRow, EX.overheadPress, EX.pullUp] },
        { id: "ul-lower", name: "Lower", exerciseIds: [EX.backSquat, EX.deadlift, EX.lunge, EX.plank] },
      ],
    },
    {
      id: "split-pt",
      name: "PT / Conditioning",
      description: "Bodyweight + conditioning for field readiness.",
      builtIn: true,
      days: [
        { id: "pt-strength", name: "Strength Base", exerciseIds: [EX.backSquat, EX.deadlift, EX.overheadPress, EX.pullUp] },
        { id: "pt-grind", name: "Grinder", exerciseIds: [EX.burpee, EX.pushUp, EX.sitUp, EX.flutterKick] },
        { id: "pt-ruck", name: "Ruck Day", exerciseIds: [EX.ruck, EX.farmerCarry, EX.plank] },
      ],
    },
  ];
}

export function seedTemplates(): Template[] {
  return [
    {
      id: "tpl-murph",
      name: "Murph",
      branch: "CrossFit Hero WOD",
      description:
        "In memory of Lt. Michael Murphy. Traditionally done wearing a 20lb vest.",
      scheme: "1 mile run · 100 pull-ups · 200 push-ups · 300 air squats · 1 mile run — for time",
      exerciseIds: [EX.run, EX.pullUp, EX.pushUp, EX.backSquat, EX.run],
    },
    {
      id: "tpl-acft",
      name: "ACFT (Army Combat Fitness Test)",
      branch: "U.S. Army",
      description: "Six-event test of combat readiness. Log each event's score.",
      scheme: "3-rep deadlift · power throw · hand-release push-ups · sprint-drag-carry · leg tuck/plank · 2-mile run",
      exerciseIds: [EX.deadlift, EX.pushUp, EX.plank, EX.run],
    },
    {
      id: "tpl-usmc-pft",
      name: "USMC PFT",
      branch: "U.S. Marine Corps",
      description: "Physical Fitness Test — max effort on each event.",
      scheme: "Pull-ups (max) · plank (max hold) · 3-mile run (for time)",
      exerciseIds: [EX.pullUp, EX.plank, EX.run],
    },
    {
      id: "tpl-navy-prt",
      name: "Navy PRT",
      branch: "U.S. Navy",
      description: "Physical Readiness Test.",
      scheme: "Forearm plank (max) · push-ups 2:00 · 1.5-mile run",
      exerciseIds: [EX.plank, EX.pushUp, EX.run],
    },
    {
      id: "tpl-cindy",
      name: "Cindy",
      branch: "CrossFit Benchmark",
      description: "AMRAP in 20 minutes.",
      scheme: "20 min AMRAP: 5 pull-ups · 10 push-ups · 15 air squats",
      exerciseIds: [EX.pullUp, EX.pushUp, EX.backSquat],
    },
    {
      id: "tpl-ruck-standard",
      name: "Standard Ruck",
      branch: "Army Ranger / SF",
      description: "Foot-march standard: 12 miles with 35lb dry pack.",
      scheme: "12 mi ruck · 35 lb load · target sub-3:00",
      exerciseIds: [EX.ruck],
    },
    {
      id: "tpl-dt",
      name: "DT",
      branch: "CrossFit Hero WOD",
      description: "In memory of USAF SSgt Timothy Davis.",
      scheme: "5 rounds: 12 deadlifts · 9 hang power cleans · 6 push press @ 155/105 lb — for time",
      exerciseIds: [EX.deadlift, EX.powerClean, EX.overheadPress],
    },
    {
      id: "tpl-chad",
      name: "Chad 1000x",
      branch: "Navy SEAL",
      description: "1,000 box step-ups with a rucksack. Honors LT Chad Wilkinson.",
      scheme: "1000 step-ups @ 20\" box · 45/35 lb ruck — for time",
      exerciseIds: [EX.boxJump, EX.ruck],
    },
  ];
}
