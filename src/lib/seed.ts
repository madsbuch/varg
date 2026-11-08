/**
 * Built-in content: every exercise, split and workout program the app ships.
 *
 * THIS FILE IS THE PROGRAM LIBRARY, AND IT IS EDITED BY HAND.
 *
 * Varg deliberately has no in-app program authoring. When the owner wants a
 * new workout they describe it in prose and an agent adds it here, then ships
 * a build. That is the intended workflow — not a gap waiting for a template
 * editor screen. All workout authoring happens in this repository.
 *
 * Consequences, because nobody reviews this content in a form before it runs:
 *
 *  - Exercise ids are permanent. They are foreign keys in the user's SQLite
 *    database and in their personal records. Never rename or reuse one.
 *  - Every exercise added here needs its own animation in ExerciseAnim.tsx
 *    and its own cues in library.ts. The category fallback in library.ts is
 *    for user-created exercises; a built-in that falls back demonstrates the
 *    wrong movement, which is how Air Squat once showed a push-up.
 *  - `bun run db:smoke` asserts both of the above, plus that no template
 *    references an exercise that does not exist. Run it.
 *  - Existing installs pick new built-ins up via mergeBuiltIns() on load;
 *    their database was seeded on first launch and is never re-seeded.
 *
 * See CLAUDE.md for the full authoring procedure.
 */
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
  airSquat: "ex-air-squat",
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
  boxStepUp: "ex-box-step-up",
  kettlebellSwing: "ex-kb-swing",
  wallBall: "ex-wall-ball",
  thruster: "ex-thruster",
  run: "ex-run",
  ruck: "ex-ruck",
  row: "ex-row-erg",
  assaultBike: "ex-assault-bike",
  farmerCarry: "ex-farmer-carry", // deprecated, see seedExercises()
  farmerCarryDistance: "ex-farmer-carry-distance",
  powerThrow: "ex-power-throw",
  sprintDragCarry: "ex-sprint-drag-carry",
  hangingLegRaise: "ex-hanging-leg-raise",
  benchDip: "ex-bench-dip",
  backLift: "ex-back-lift",
  runInPlace: "ex-run-in-place",
  airBoxing: "ex-air-boxing",
  kneeLift: "ex-knee-lift",
  reverseLunge: "ex-reverse-lunge",
  armCircles: "ex-arm-circles",
  ankleRock: "ex-ankle-rock",
  catCow: "ex-cat-cow",
  hip90Switch: "ex-hip-90-switch",
  worldsGreatestStretch: "ex-worlds-greatest-stretch",
  hipFlexorStretch: "ex-hip-flexor-stretch",
  openBook: "ex-open-book",
  downDogCobra: "ex-down-dog-cobra",
  // Yoga holds, for the Varg Yoga flows.
  childsPose: "ex-childs-pose",
  downwardDog: "ex-downward-dog",
  upwardSalute: "ex-upward-salute",
  standingForwardFold: "ex-standing-forward-fold",
  chairPose: "ex-chair-pose",
  warriorTwo: "ex-warrior-two",
  trianglePose: "ex-triangle-pose",
  treePose: "ex-tree-pose",
  pigeonPose: "ex-pigeon-pose",
  boatPose: "ex-boat-pose",
  bridgePose: "ex-bridge-pose",
  seatedForwardFold: "ex-seated-forward-fold",
  savasana: "ex-savasana",
  // DT's lifts as prescribed: it shipped mapped to Power Clean (from the
  // floor) and Overhead Press (strict). Those ids stay — logged sessions
  // reference them — and DT now points here.
  hangPowerClean: "ex-hang-power-clean",
  pushPress: "ex-push-press",
  // Yoga's low lunge. Same shape as the Kneeling Hip Flexor Stretch, but
  // the flow should say the pose's name, not the stretch's.
  lowLunge: "ex-low-lunge",
  // The road to a first pull-up, and the scaled CrossFit staples.
  ringRow: "ex-ring-row",
  deadHang: "ex-dead-hang",
  scapPull: "ex-scap-pull-up",
  pullupNegative: "ex-pull-up-negative",
  bandPullup: "ex-band-pull-up",
  singleUnder: "ex-single-under",
  doubleUnder: "ex-double-under",
  spinBike: "ex-spin-bike",
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
    e(EX.backSquat, "Back Squat", "strength", "weight_reps", [
      "quads",
      "glutes",
    ]),
    e(EX.frontSquat, "Front Squat", "strength", "weight_reps", [
      "quads",
      "core",
    ]),
    e(EX.deadlift, "Deadlift", "strength", "weight_reps", [
      "posterior chain",
      "back",
    ]),
    e(EX.benchPress, "Bench Press", "strength", "weight_reps", [
      "chest",
      "triceps",
    ]),
    e(EX.overheadPress, "Overhead Press", "strength", "weight_reps", [
      "shoulders",
      "triceps",
    ]),
    e(EX.barbellRow, "Barbell Row", "strength", "weight_reps", [
      "back",
      "biceps",
    ]),
    e(EX.powerClean, "Power Clean", "strength", "weight_reps", ["full body"]),
    e(EX.hangPowerClean, "Hang Power Clean", "strength", "weight_reps", ["full body", "traps"]),
    e(EX.pushPress, "Push Press", "strength", "weight_reps", ["shoulders", "triceps", "legs"]),
    e(EX.thruster, "Thruster", "conditioning", "weight_reps", ["full body"]),
    e(EX.kettlebellSwing, "Kettlebell Swing", "conditioning", "weight_reps", [
      "posterior chain",
    ]),
    e(EX.wallBall, "Wall Ball", "conditioning", "weight_reps", [
      "legs",
      "shoulders",
    ]),
    // A carry is a distance under load, not a set of reps. The original
    // ex-farmer-carry is weight_reps: it asked for a rep count on a walk,
    // offered no distance field, and minted an Est. 1RM from whatever
    // number was typed. It cannot be corrected in place — mergeBuiltIns()
    // only adds ids it has never seen, and the SQLite loader only writes
    // rows it does not already know, so editing a shipped exercise's name,
    // metric or muscles is a no-op on every device except a fresh install.
    // A semantic correction therefore ships as a NEW id with templates and
    // splits repointed. The old id keeps its library.ts entry so existing
    // history and personal records still resolve to the right movement,
    // and it is left out of this list so no fresh install offers both.
    e(
      EX.farmerCarryDistance,
      "Farmer's Carry",
      "conditioning",
      "distance_time",
      ["grip", "core"],
    ),
    e(EX.airSquat, "Air Squat", "bodyweight", "reps", ["quads", "glutes"]),
    e(EX.pullUp, "Pull-up", "bodyweight", "reps", ["back", "biceps"]),
    e(EX.chinUp, "Chin-up", "bodyweight", "reps", ["back", "biceps"]),
    e(EX.pushUp, "Push-up", "bodyweight", "reps", ["chest", "triceps"]),
    e(EX.dip, "Dip", "bodyweight", "reps", ["chest", "triceps"]),
    e(EX.benchDip, "Bench Dip", "bodyweight", "reps", ["triceps", "chest"]),
    e(EX.sitUp, "Sit-up", "core", "reps", ["core"]),
    e(EX.backLift, "Back Lift", "core", "reps", ["lower back", "glutes"]),
    e(EX.flutterKick, "Flutter Kick", "core", "reps", ["core"]),
    e(EX.hangingLegRaise, "Hanging Leg Raise", "core", "reps", ["core"]),
    e(EX.lunge, "Walking Lunge", "bodyweight", "reps", ["quads", "glutes"]),
    e(EX.reverseLunge, "Reverse Lunge", "bodyweight", "reps", [
      "quads",
      "glutes",
      "hip flexors",
    ]),
    e(EX.kneeLift, "Standing Knee Lift", "bodyweight", "reps", [
      "hip flexors",
      "core",
    ]),
    e(EX.armCircles, "Arm Circles", "bodyweight", "time", [
      "shoulders",
      "upper back",
    ]),
    e(EX.ankleRock, "Ankle Rock", "bodyweight", "time", ["ankles", "calves"]),
    e(EX.catCow, "Cat-Cow", "core", "time", ["spine", "core"]),
    e(EX.hip90Switch, "90/90 Hip Switch", "bodyweight", "time", [
      "hips",
      "glutes",
    ]),
    e(
      EX.worldsGreatestStretch,
      "World's Greatest Stretch",
      "bodyweight",
      "time",
      ["hips", "spine", "hamstrings"],
    ),
    e(
      EX.hipFlexorStretch,
      "Kneeling Hip Flexor Stretch",
      "bodyweight",
      "time",
      ["hip flexors", "quads"],
    ),
    e(EX.openBook, "Open Book", "core", "time", ["spine", "shoulders"]),
    e(EX.downDogCobra, "Down Dog to Cobra", "bodyweight", "time", [
      "shoulders",
      "spine",
      "calves",
    ]),
    e(EX.childsPose, "Child's Pose", "bodyweight", "time", ["back", "hips"]),
    e(EX.downwardDog, "Downward Dog", "bodyweight", "time", ["hamstrings", "calves", "shoulders"]),
    e(EX.upwardSalute, "Upward Salute", "bodyweight", "time", ["shoulders", "spine"]),
    e(EX.standingForwardFold, "Standing Forward Fold", "bodyweight", "time", ["hamstrings", "back"]),
    e(EX.chairPose, "Chair Pose", "bodyweight", "time", ["quads", "glutes", "shoulders"]),
    e(EX.warriorTwo, "Warrior II", "bodyweight", "time", ["quads", "hips", "shoulders"]),
    e(EX.trianglePose, "Triangle Pose", "bodyweight", "time", ["hamstrings", "hips", "obliques"]),
    e(EX.treePose, "Tree Pose", "bodyweight", "time", ["balance", "ankles", "hips"]),
    e(EX.pigeonPose, "Pigeon Pose", "bodyweight", "time", ["glutes", "hips"]),
    e(EX.boatPose, "Boat Pose", "core", "time", ["core", "hip flexors"]),
    e(EX.bridgePose, "Bridge Pose", "bodyweight", "time", ["glutes", "hamstrings", "spine"]),
    e(EX.seatedForwardFold, "Seated Forward Fold", "bodyweight", "time", ["hamstrings", "back"]),
    e(EX.savasana, "Savasana", "bodyweight", "time", ["recovery"]),
    e(EX.lowLunge, "Low Lunge", "bodyweight", "time", ["hip flexors", "quads"]),
    e(EX.ringRow, "Ring Row", "bodyweight", "reps", ["back", "biceps"]),
    e(EX.deadHang, "Dead Hang", "bodyweight", "time", ["grip", "shoulders"]),
    e(EX.scapPull, "Scapular Pull-up", "bodyweight", "reps", ["lats", "shoulders"]),
    e(EX.pullupNegative, "Pull-up Negative", "bodyweight", "reps", ["lats", "biceps"]),
    e(EX.bandPullup, "Band-Assisted Pull-up", "bodyweight", "reps", ["lats", "biceps"]),
    e(EX.singleUnder, "Single-Under", "conditioning", "reps", ["calves", "coordination"]),
    e(EX.doubleUnder, "Double-Under", "conditioning", "reps", ["calves", "coordination"]),
    e(EX.spinBike, "Spin Bike", "cardio", "time", ["legs", "conditioning"]),
    e(EX.burpee, "Burpee", "conditioning", "reps", ["full body"]),
    e(EX.boxJump, "Box Jump", "conditioning", "reps", ["legs"]),
    e(EX.boxStepUp, "Box Step-up", "conditioning", "reps", ["legs", "glutes"]),
    // Both ACFT events are scored on a single effort: metres thrown, and
    // the 250 m shuttle's clock time. They are distance_time and not time
    // because a "time" PR is a maximum (prs.ts) — for a for-time event
    // that would record the athlete's worst run as their record.
    e(EX.powerThrow, "Standing Power Throw", "conditioning", "distance_time", [
      "full body",
    ]),
    e(
      EX.sprintDragCarry,
      "Sprint-Drag-Carry",
      "conditioning",
      "distance_time",
      ["full body"],
    ),
    e(EX.plank, "Plank", "core", "time", ["core"]),
    e(EX.run, "Run", "cardio", "distance_time", ["conditioning"]),
    e(EX.runInPlace, "Run on the Spot", "cardio", "time", ["conditioning"]),
    e(EX.airBoxing, "Air Boxing", "cardio", "time", [
      "conditioning",
      "shoulders",
    ]),
    e(EX.ruck, "Ruck March", "ruck", "distance_time", ["conditioning", "legs"]),
    e(EX.row, "Row (Erg)", "cardio", "distance_time", ["conditioning"]),
    e(EX.assaultBike, "Assault Bike", "cardio", "distance_time", [
      "conditioning",
    ]),
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
        {
          id: "ppl-push",
          name: "Push",
          exerciseIds: [EX.benchPress, EX.overheadPress, EX.dip, EX.pushUp],
        },
        {
          id: "ppl-pull",
          name: "Pull",
          exerciseIds: [EX.deadlift, EX.barbellRow, EX.pullUp, EX.chinUp],
        },
        {
          id: "ppl-legs",
          name: "Legs",
          exerciseIds: [EX.backSquat, EX.frontSquat, EX.lunge, EX.boxJump],
        },
      ],
    },
    {
      id: "split-upper-lower",
      name: "Upper / Lower",
      description: "4-day strength split.",
      builtIn: true,
      days: [
        {
          id: "ul-upper",
          name: "Upper",
          exerciseIds: [
            EX.benchPress,
            EX.barbellRow,
            EX.overheadPress,
            EX.pullUp,
          ],
        },
        {
          id: "ul-lower",
          name: "Lower",
          exerciseIds: [EX.backSquat, EX.deadlift, EX.lunge, EX.plank],
        },
      ],
    },
    {
      id: "split-pt",
      name: "PT / Conditioning",
      description: "Bodyweight + conditioning for field readiness.",
      builtIn: true,
      days: [
        {
          id: "pt-strength",
          name: "Strength Base",
          exerciseIds: [EX.backSquat, EX.deadlift, EX.overheadPress, EX.pullUp],
        },
        {
          id: "pt-grind",
          name: "Grinder",
          exerciseIds: [EX.burpee, EX.pushUp, EX.sitUp, EX.flutterKick],
        },
        {
          id: "pt-ruck",
          name: "Ruck Day",
          exerciseIds: [EX.ruck, EX.farmerCarryDistance, EX.plank],
        },
      ],
    },
  ];
}

export function seedTemplates(): Template[] {
  return [
    {
      id: "tpl-varg-18",
      name: "Varg 18",
      branch: "Varg",
      description:
        "Twelve stations, strength alternating with cardio — no station " +
        "repeats back to back. Cardio alternates run on the spot and air boxing.",
      // No total here: the card computes and shows the real clock time,
      // and two numbers that disagree by ten seconds is worse than one.
      scheme: "3 rounds · 12 stations · 20 s work / 10 s rest",
      level: "intermediate",
      // Strength station, cardio, strength station, cardio… The two cardio
      // exercises alternate, and there are six cardio slots per round, so
      // the pattern stays in phase across round boundaries too.
      exerciseIds: [
        EX.sitUp,
        EX.runInPlace,
        EX.pushUp,
        EX.airBoxing,
        EX.backLift,
        EX.runInPlace,
        EX.airSquat,
        EX.airBoxing,
        EX.benchDip,
        EX.runInPlace,
        EX.burpee,
        EX.airBoxing,
      ],
      interval: { work: 20, rest: 10, rounds: 3 },
      music: {
        bpm: 160,
        style: "hard electronic, punchy drums, dark synth bass, no vocals",
        theme:
          "Eighteen minutes of short brutal intervals — wolf-pack pace, never a full breath",
      },
    },
    {
      id: "tpl-varg-30",
      name: "Varg 30",
      branch: "Varg",
      description:
        "Varg 18 with longer work: the same twelve stations in the same " +
        "order, strength alternating with cardio, but 40 seconds under load " +
        "per station. Cardio alternates run on the spot and air boxing.",
      scheme: "3 rounds · 12 stations · 40 s work / 10 s rest",
      level: "advanced",
      // Identical station order to Varg 18 — only the work time changes.
      exerciseIds: [
        EX.sitUp,
        EX.runInPlace,
        EX.pushUp,
        EX.airBoxing,
        EX.backLift,
        EX.runInPlace,
        EX.airSquat,
        EX.airBoxing,
        EX.benchDip,
        EX.runInPlace,
        EX.burpee,
        EX.airBoxing,
      ],
      interval: { work: 40, rest: 10, rounds: 3 },
      music: {
        bpm: 160,
        style: "hard electronic, punchy drums, dark synth bass, no vocals",
        theme:
          "Thirty minutes of long grinding intervals — wolf-pack pace held past the burn",
      },
    },
    {
      id: "tpl-varg-yoga-10",
      name: "Varg Yoga 10",
      branch: "Varg",
      description:
        "Ten minutes of holds for any day: wake the spine, stand strong, " +
        "balance, open the hips, a little core, then settle. Between poses " +
        "you get 10 seconds to move while the voice names the next one, " +
        "with form cues on screen; one-sided poses go left, then right.",
      scheme: "12:40 flow · 17 poses · holds of 30–40 s · 10 s to move between poses · both sides",
      level: "beginner",
      exerciseIds: [
        EX.childsPose, EX.catCow, EX.downwardDog, EX.upwardSalute,
        EX.standingForwardFold, EX.chairPose, EX.warriorTwo, EX.trianglePose,
        EX.treePose, EX.pigeonPose, EX.boatPose, EX.bridgePose, EX.savasana,
      ],
      // Holds: 40+40+40+30+30+30 + 2×40 + 2×35 + 2×30 + 2×40 + 30+40+30
      // = 600 s, plus 16 moves of 10 s = 760 s (12:40).
      flow: {
        transition: 10,
        steps: [
          { exerciseId: EX.childsPose, seconds: 40 },
          { exerciseId: EX.catCow, seconds: 40 },
          { exerciseId: EX.downwardDog, seconds: 40 },
          { exerciseId: EX.upwardSalute, seconds: 30 },
          { exerciseId: EX.standingForwardFold, seconds: 30 },
          { exerciseId: EX.chairPose, seconds: 30 },
          { exerciseId: EX.warriorTwo, seconds: 40, side: "left" },
          { exerciseId: EX.warriorTwo, seconds: 40, side: "right" },
          { exerciseId: EX.trianglePose, seconds: 35, side: "left" },
          { exerciseId: EX.trianglePose, seconds: 35, side: "right" },
          { exerciseId: EX.treePose, seconds: 30, side: "left" },
          { exerciseId: EX.treePose, seconds: 30, side: "right" },
          { exerciseId: EX.pigeonPose, seconds: 40, side: "left" },
          { exerciseId: EX.pigeonPose, seconds: 40, side: "right" },
          { exerciseId: EX.boatPose, seconds: 30 },
          { exerciseId: EX.bridgePose, seconds: 40 },
          { exerciseId: EX.savasana, seconds: 30 },
        ],
      },
      music: {
        bpm: 70,
        style: "calm ambient, soft pads, gentle hand percussion, no vocals",
        theme: "Ten quiet minutes on the mat — breath, balance and a slow reset",
      },
    },
    {
      id: "tpl-varg-yoga-20",
      name: "Varg Yoga 20",
      branch: "Varg",
      description:
        "Twenty minutes of holds: longer holds and more of everything — a " +
        "sun-salutation start, standing strength and balance, core, deep " +
        "hips and hamstrings, a spinal twist, and a proper rest at the end. " +
        "10 seconds to move between poses while the voice names the next one, " +
        "and on-screen cues throughout.",
      scheme: "24:00 flow · 25 poses · holds of 30–85 s · 10 s to move between poses · both sides",
      level: "beginner",
      exerciseIds: [
        EX.childsPose, EX.catCow, EX.downwardDog, EX.upwardSalute,
        EX.standingForwardFold, EX.plank, EX.downDogCobra, EX.lowLunge,
        EX.chairPose, EX.warriorTwo, EX.trianglePose, EX.treePose,
        EX.worldsGreatestStretch, EX.boatPose, EX.pigeonPose,
        EX.seatedForwardFold, EX.bridgePose, EX.openBook, EX.savasana,
      ],
      // 60+60+45+30+45+30+45 + 2×45 + 45 + 2×45 + 2×45 + 2×40 + 60 + 30
      // + 2×60 + 60 + 45 + 2×45 + 85 = 1200 s of holds, plus 24 moves of
      // 10 s = 1440 s (24:00).
      flow: {
        transition: 10,
        steps: [
          { exerciseId: EX.childsPose, seconds: 60 },
          { exerciseId: EX.catCow, seconds: 60 },
          { exerciseId: EX.downwardDog, seconds: 45 },
          { exerciseId: EX.upwardSalute, seconds: 30 },
          { exerciseId: EX.standingForwardFold, seconds: 45 },
          { exerciseId: EX.plank, seconds: 30 },
          { exerciseId: EX.downDogCobra, seconds: 45 },
          { exerciseId: EX.lowLunge, seconds: 45, side: "left" },
          { exerciseId: EX.lowLunge, seconds: 45, side: "right" },
          { exerciseId: EX.chairPose, seconds: 45 },
          { exerciseId: EX.warriorTwo, seconds: 45, side: "left" },
          { exerciseId: EX.warriorTwo, seconds: 45, side: "right" },
          { exerciseId: EX.trianglePose, seconds: 45, side: "left" },
          { exerciseId: EX.trianglePose, seconds: 45, side: "right" },
          { exerciseId: EX.treePose, seconds: 40, side: "left" },
          { exerciseId: EX.treePose, seconds: 40, side: "right" },
          { exerciseId: EX.worldsGreatestStretch, seconds: 60 },
          { exerciseId: EX.boatPose, seconds: 30 },
          { exerciseId: EX.pigeonPose, seconds: 60, side: "left" },
          { exerciseId: EX.pigeonPose, seconds: 60, side: "right" },
          { exerciseId: EX.seatedForwardFold, seconds: 60 },
          { exerciseId: EX.bridgePose, seconds: 45 },
          { exerciseId: EX.openBook, seconds: 45, side: "left" },
          { exerciseId: EX.openBook, seconds: 45, side: "right" },
          { exerciseId: EX.savasana, seconds: 85 },
        ],
      },
      music: {
        bpm: 72,
        style: "calm ambient, warm pads, soft piano, slow hand drums, no vocals",
        theme: "Twenty unhurried minutes of strength, balance and release — breathe and settle",
      },
    },
    // --- Indoor bike rides ----------------------------------------------------
    // Targets are % of FTP (Settings → Cycling), so they follow the rider's
    // FTP. Zones are Coggan's: Z2 56–75 %, sweet spot 88–94 %, VO2 106–120 %.
    {
      id: "tpl-ride-z2-40",
      name: "Zone 2 · 40",
      branch: "Spin bike",
      description:
        "Forty minutes in zone 2: easy enough to talk, steady enough to " +
        "build the engine. The screen shows your watts against the zone, " +
        "and the ride logs how much of it you spent on target.",
      scheme: "40 min @ zone 2 (56–75 % FTP) · 85–95 rpm",
      level: "beginner",
      exerciseIds: [EX.spinBike],
      ride: {
        segments: [{ label: "Zone 2", ftp: [56, 75], seconds: 2400, cadence: [85, 95] }],
      },
      music: { bpm: 128, style: "steady deep house, warm bass, rolling groove, no vocals", theme: "Forty easy, even minutes — a long steady engine-building ride" },
    },
    {
      id: "tpl-ride-200-kcal",
      name: "First to 200 kcal",
      branch: "Spin bike",
      description:
        "A race against the clock: 200 kcal as fast as you can make them. " +
        "Kcal come from the bike, so it ends itself at 200; the target is " +
        "threshold and above — pace it, then empty the tank.",
      scheme: "200 kcal @ 95–120 % FTP — for time",
      level: "intermediate",
      estimateMinutes: 12,
      exerciseIds: [EX.spinBike],
      ride: {
        race: true,
        segments: [{ label: "All out", ftp: [95, 120], kcal: 200, cadence: [90, 110] }],
      },
      music: { bpm: 172, style: "hard electronic, driving drums, aggressive synth", theme: "A flat-out calorie race — no pacing after halfway" },
    },
    {
      id: "tpl-ride-sweet-spot",
      name: "Sweet Spot 3×10",
      branch: "Spin bike",
      description:
        "The FTP builder: three ten-minute blocks just under threshold, five " +
        "easy minutes between, a ten-minute warm-up and a five-minute spin " +
        "to finish.",
      scheme: "10 min warm-up · 3 × 10 min @ 88–94 % FTP, 5 min easy between · 5 min cool-down",
      level: "intermediate",
      exerciseIds: [EX.spinBike],
      // 600 + 600 + 300 + 600 + 300 + 600 + 300 = 3300 s (55:00).
      ride: {
        segments: [
          { label: "Warm-up", ftp: [50, 65], seconds: 600, cadence: [85, 95] },
          { label: "Sweet spot", ftp: [88, 94], seconds: 600, cadence: [85, 95] },
          { label: "Easy spin", ftp: [45, 55], seconds: 300 },
          { label: "Sweet spot", ftp: [88, 94], seconds: 600, cadence: [85, 95] },
          { label: "Easy spin", ftp: [45, 55], seconds: 300 },
          { label: "Sweet spot", ftp: [88, 94], seconds: 600, cadence: [85, 95] },
          { label: "Cool-down", ftp: [40, 55], seconds: 300 },
        ],
      },
      music: { bpm: 132, style: "progressive house, building synths, steady kick, no vocals", theme: "Long controlled efforts just under the red line" },
    },
    {
      id: "tpl-ride-vo2-5x3",
      name: "VO2 Max 5×3",
      branch: "Spin bike",
      description:
        "Five three-minute efforts above threshold with equal recovery. Hard " +
        "from the second minute of each — that's the point.",
      scheme: "10 min warm-up · 5 × 3 min @ 106–120 % FTP, 3 min easy between · 5 min cool-down",
      level: "advanced",
      exerciseIds: [EX.spinBike],
      // 600 + 5 × (180 + 180) + 300 = 2700 s (45:00); the fifth recovery
      // runs straight into the cool-down.
      ride: {
        segments: [
          { label: "Warm-up", ftp: [50, 70], seconds: 600, cadence: [85, 95] },
          ...[1, 2, 3, 4, 5].flatMap((n) => [
            { label: `VO2 effort ${String(n)}`, ftp: [106, 120] as [number, number], seconds: 180, cadence: [95, 105] as [number, number] },
            { label: "Easy spin", ftp: [40, 55] as [number, number], seconds: 180 },
          ]),
          { label: "Cool-down", ftp: [40, 55], seconds: 300 },
        ],
      },
      music: { bpm: 140, style: "hard techno, pounding kick, rising tension, no vocals", theme: "Three minutes at a time, deep in the red" },
    },
    {
      id: "tpl-ride-tabata",
      name: "Bike Tabata",
      branch: "Spin bike",
      description:
        "Eight rounds of 20 seconds all out, 10 seconds easy, after a proper " +
        "warm-up. Four minutes that feel like forty.",
      scheme: "8 min warm-up · 8 × 20 s all out (150 %+ FTP) / 10 s easy · 6 min cool-down",
      level: "advanced",
      exerciseIds: [EX.spinBike],
      // 480 + 8 × 30 + 360 = 1080 s (18:00).
      ride: {
        segments: [
          { label: "Warm-up", ftp: [50, 65], seconds: 480, cadence: [85, 95] },
          ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(() => [
            { label: "Sprint", ftp: [150, 250] as [number, number], seconds: 20, cadence: [110, 130] as [number, number] },
            { label: "Easy", ftp: [30, 50] as [number, number], seconds: 10 },
          ]),
          { label: "Cool-down", ftp: [40, 55], seconds: 360 },
        ],
      },
      music: { bpm: 174, style: "frantic drum and bass, huge drops, no vocals", theme: "Eight sprints, nothing held back" },
    },
    {
      id: "tpl-ride-kcal-ladder",
      name: "Calorie Ladder",
      branch: "Spin bike",
      description:
        "A race up a ladder: 50, 100, then 150 kcal at threshold, with three " +
        "easy minutes between rungs. The clock never stops — the score is " +
        "your total time.",
      scheme: "50 kcal · 3 min easy · 100 kcal · 3 min easy · 150 kcal @ 95–110 % FTP — for time",
      level: "intermediate",
      estimateMinutes: 26,
      exerciseIds: [EX.spinBike],
      ride: {
        race: true,
        segments: [
          { label: "Rung one", ftp: [95, 110], kcal: 50, cadence: [90, 100] },
          { label: "Easy spin", ftp: [45, 55], seconds: 180 },
          { label: "Rung two", ftp: [95, 110], kcal: 100, cadence: [90, 100] },
          { label: "Easy spin", ftp: [45, 55], seconds: 180 },
          { label: "Rung three", ftp: [95, 110], kcal: 150, cadence: [90, 100] },
        ],
      },
      music: { bpm: 150, style: "driving electro, big bassline, no vocals", theme: "Climb the ladder — every rung longer than the last" },
    },
    // --- CrossFit benchmarks, for time ------------------------------------
    // The classic "Girls" at their standard prescription, and scaled
    // versions for where the owner is now: no pull-up yet, so every
    // pull-up becomes a ring row, and the loads come down.
    {
      id: "tpl-fran",
      name: "Fran",
      branch: "CrossFit Benchmark",
      description:
        "The sprint benchmark: thrusters and pull-ups, 21-15-9. Short and " +
        "savage — most finish between 3 and 10 minutes.",
      scheme: "21-15-9 thrusters @ 43/29 kg · pull-ups — for time",
      level: "advanced",
      estimateMinutes: 8,
      exerciseIds: [EX.thruster, EX.pullUp],
      forTime: {
        stages: [21, 15, 9].flatMap((n) => [
          { exerciseId: EX.thruster, label: `${String(n)} thrusters`, reps: n },
          { exerciseId: EX.pullUp, label: `${String(n)} pull-ups`, reps: n },
        ]),
      },
      music: { bpm: 178, style: "aggressive industrial metal, pounding drums", theme: "Three minutes of pure redline — no pacing, just go" },
    },
    {
      id: "tpl-fran-scaled",
      name: "Fran (scaled)",
      branch: "CrossFit Scaled",
      description:
        "Fran for before your first pull-up: the same 21-15-9, with a light " +
        "bar and ring rows. Set the rings so the last rows are hard but clean.",
      scheme: "21-15-9 thrusters @ 20/15 kg · ring rows — for time",
      level: "beginner",
      estimateMinutes: 8,
      exerciseIds: [EX.thruster, EX.ringRow],
      forTime: {
        stages: [21, 15, 9].flatMap((n) => [
          { exerciseId: EX.thruster, label: `${String(n)} thrusters`, reps: n },
          { exerciseId: EX.ringRow, label: `${String(n)} ring rows`, reps: n },
        ]),
      },
      music: { bpm: 172, style: "driving electronic rock, heavy kick", theme: "Short and sharp — learn to suffer for a few minutes" },
    },
    {
      id: "tpl-helen",
      name: "Helen",
      branch: "CrossFit Benchmark",
      description: "Three rounds of a run, kettlebell swings and pull-ups.",
      scheme: "3 rounds: 400 m run · 21 kettlebell swings @ 24/16 kg · 12 pull-ups — for time",
      level: "advanced",
      estimateMinutes: 12,
      exerciseIds: [EX.run, EX.kettlebellSwing, EX.pullUp],
      forTime: {
        stages: [1, 2, 3].flatMap((r) => [
          { exerciseId: EX.run, label: `Round ${String(r)} · 400 m run`, meters: 400 },
          { exerciseId: EX.kettlebellSwing, label: `Round ${String(r)} · 21 kettlebell swings`, reps: 21 },
          { exerciseId: EX.pullUp, label: `Round ${String(r)} · 12 pull-ups`, reps: 12 },
        ]),
      },
      music: { bpm: 170, style: "hard rock, galloping drums, distorted bass", theme: "Run, swing, pull — three hard laps" },
    },
    {
      id: "tpl-helen-scaled",
      name: "Helen (scaled)",
      branch: "CrossFit Scaled",
      description: "Helen with a lighter bell and ring rows in place of pull-ups.",
      scheme: "3 rounds: 400 m run · 21 kettlebell swings @ 16/12 kg · 12 ring rows — for time",
      level: "beginner",
      estimateMinutes: 15,
      exerciseIds: [EX.run, EX.kettlebellSwing, EX.ringRow],
      forTime: {
        stages: [1, 2, 3].flatMap((r) => [
          { exerciseId: EX.run, label: `Round ${String(r)} · 400 m run`, meters: 400 },
          { exerciseId: EX.kettlebellSwing, label: `Round ${String(r)} · 21 kettlebell swings`, reps: 21 },
          { exerciseId: EX.ringRow, label: `Round ${String(r)} · 12 ring rows`, reps: 12 },
        ]),
      },
      music: { bpm: 164, style: "punchy rock, steady drive", theme: "Three honest rounds — keep moving" },
    },
    {
      id: "tpl-jackie",
      name: "Jackie",
      branch: "CrossFit Benchmark",
      description: "Row, thrusters, pull-ups — one long chipper, one lap each.",
      scheme: "1000 m row · 50 thrusters @ 20/15 kg · 30 pull-ups — for time",
      level: "advanced",
      estimateMinutes: 12,
      exerciseIds: [EX.row, EX.thruster, EX.pullUp],
      forTime: {
        stages: [
          { exerciseId: EX.row, label: "1000 m row", meters: 1000 },
          { exerciseId: EX.thruster, label: "50 thrusters", reps: 50 },
          { exerciseId: EX.pullUp, label: "30 pull-ups", reps: 30 },
        ],
      },
      music: { bpm: 168, style: "dark electronic, rolling bassline, hard drums", theme: "Pull the erg, then grind through the bar" },
    },
    {
      id: "tpl-jackie-scaled",
      name: "Jackie (scaled)",
      branch: "CrossFit Scaled",
      description: "Jackie with a training bar and ring rows.",
      scheme: "1000 m row · 50 thrusters @ 15/10 kg · 30 ring rows — for time",
      level: "beginner",
      estimateMinutes: 15,
      exerciseIds: [EX.row, EX.thruster, EX.ringRow],
      forTime: {
        stages: [
          { exerciseId: EX.row, label: "1000 m row", meters: 1000 },
          { exerciseId: EX.thruster, label: "50 thrusters", reps: 50 },
          { exerciseId: EX.ringRow, label: "30 ring rows", reps: 30 },
        ],
      },
      music: { bpm: 160, style: "dark electronic, steady groove", theme: "A long steady chipper — find a rhythm and hold it" },
    },
    {
      id: "tpl-karen",
      name: "Karen",
      branch: "CrossFit Benchmark",
      description:
        "One movement, one number: 150 wall balls. Break them into sets " +
        "before you have to — 10s or 15s with short rests.",
      scheme: "150 wall balls @ 9/6 kg to a 3 m target — for time",
      level: "intermediate",
      estimateMinutes: 12,
      exerciseIds: [EX.wallBall],
      forTime: { stages: [{ exerciseId: EX.wallBall, label: "150 wall balls", reps: 150 }] },
      music: { bpm: 166, style: "relentless techno, four-on-the-floor", theme: "Squat, throw, catch — one hundred and fifty times" },
    },
    {
      id: "tpl-kelly",
      name: "Kelly",
      branch: "CrossFit Benchmark",
      description: "Five long rounds of running, jumping and throwing — a lung burner.",
      scheme: "5 rounds: 400 m run · 30 box jumps @ 60/50 cm · 30 wall balls @ 9/6 kg — for time",
      level: "advanced",
      estimateMinutes: 35,
      exerciseIds: [EX.run, EX.boxJump, EX.wallBall],
      forTime: {
        stages: [1, 2, 3, 4, 5].flatMap((r) => [
          { exerciseId: EX.run, label: `Round ${String(r)} · 400 m run`, meters: 400 },
          { exerciseId: EX.boxJump, label: `Round ${String(r)} · 30 box jumps`, reps: 30 },
          { exerciseId: EX.wallBall, label: `Round ${String(r)} · 30 wall balls`, reps: 30 },
        ]),
      },
      music: { bpm: 168, style: "hard electronic rock, big drums", theme: "Five rounds of lungs and legs — keep the engine running" },
    },
    {
      id: "tpl-annie",
      name: "Annie",
      branch: "CrossFit Benchmark",
      description: "Double-unders and sit-ups in a descending ladder.",
      scheme: "50-40-30-20-10 double-unders · sit-ups — for time",
      level: "advanced",
      estimateMinutes: 10,
      exerciseIds: [EX.doubleUnder, EX.sitUp],
      forTime: {
        stages: [50, 40, 30, 20, 10].flatMap((n) => [
          { exerciseId: EX.doubleUnder, label: `${String(n)} double-unders`, reps: n },
          { exerciseId: EX.sitUp, label: `${String(n)} sit-ups`, reps: n },
        ]),
      },
      music: { bpm: 172, style: "fast drum and bass, crisp breaks", theme: "Quick feet, hard core, a ladder down to the finish" },
    },
    {
      id: "tpl-annie-scaled",
      name: "Annie (scaled)",
      branch: "CrossFit Scaled",
      description: "Annie with single-unders while the double-unders come.",
      scheme: "50-40-30-20-10 single-unders · sit-ups — for time",
      level: "beginner",
      estimateMinutes: 12,
      exerciseIds: [EX.singleUnder, EX.sitUp],
      forTime: {
        stages: [50, 40, 30, 20, 10].flatMap((n) => [
          { exerciseId: EX.singleUnder, label: `${String(n)} single-unders`, reps: n },
          { exerciseId: EX.sitUp, label: `${String(n)} sit-ups`, reps: n },
        ]),
      },
      music: { bpm: 164, style: "upbeat drum and bass", theme: "Light on the feet — skip, crunch, repeat" },
    },
    {
      id: "tpl-half-murph-scaled",
      name: "Half Murph (scaled)",
      branch: "CrossFit Scaled",
      description:
        "Half of Murph, scaled for before your first pull-up: ring rows in " +
        "place of pull-ups, no vest. Push-ups from the knees or with hands " +
        "on a box are fine — partition the middle however you like.",
      scheme: "800 m run · 50 ring rows · 100 push-ups · 150 air squats · 800 m run — for time",
      level: "intermediate",
      estimateMinutes: 35,
      exerciseIds: [EX.run, EX.ringRow, EX.pushUp, EX.airSquat],
      forTime: {
        stages: [
          { exerciseId: EX.run, label: "800 m run", meters: 800 },
          { exerciseId: EX.ringRow, label: "50 ring rows", reps: 50 },
          { exerciseId: EX.pushUp, label: "100 push-ups", reps: 100 },
          { exerciseId: EX.airSquat, label: "150 air squats", reps: 150 },
          { exerciseId: EX.run, label: "800 m run", meters: 800 },
        ],
      },
      music: { bpm: 170, style: "aggressive electronic rock, pounding drums", theme: "Half the hero, all the honour — earn the full one" },
    },
    // --- The road to a first pull-up ------------------------------------------
    {
      id: "tpl-pullup-path-1",
      name: "Pull-up Path 1",
      branch: "Varg",
      description:
        "For when a pull-up is still out of reach. Hangs build the grip, " +
        "scapular pulls the first inch, rows the back, and slow negatives " +
        "the strength to pull. Two or three times a week. Ready for Path 2 " +
        "when you can hang the full 30 s and lower for 3–5 s on every negative.",
      scheme: "4 rounds · 4 stations · 30 s work / 30 s rest",
      level: "beginner",
      exerciseIds: [EX.deadHang, EX.scapPull, EX.ringRow, EX.pullupNegative],
      interval: { work: 30, rest: 30, rounds: 4 },
      music: { bpm: 150, style: "steady hip-hop beat, heavy bass, no vocals", theme: "Patient strength — one more second on the bar each week" },
    },
    {
      id: "tpl-pullup-path-2",
      name: "Pull-up Path 2",
      branch: "Varg",
      description:
        "The next step: longer hangs and negatives, band-assisted pull-ups " +
        "and rows. Use the thinnest band that still lets you do clean reps; " +
        "when that band gets easy, try one strict pull-up at the start of " +
        "the session.",
      scheme: "4 rounds · 4 stations · 40 s work / 30 s rest",
      level: "intermediate",
      exerciseIds: [EX.deadHang, EX.pullupNegative, EX.bandPullup, EX.ringRow],
      interval: { work: 40, rest: 30, rounds: 4 },
      music: { bpm: 154, style: "boom-bap hip-hop beat, deep bass, no vocals", theme: "Closing in on the first pull-up — grind and believe" },
    },
    {
      id: "tpl-rasteplads",
      name: "Rasteplads",
      branch: "Varg",
      description:
        "Rest-stop reset after one to two hours behind the wheel. Standing " +
        "only — nothing goes on the tarmac. Opens the hips the seat closed " +
        "down, unlocks the shoulders, moves blood without soaking your shirt " +
        "for the next leg.",
      scheme: "3 rounds · 6 stations · 15 s work, no rest — 90 s a round",
      level: "beginner",
      // Legs first: the seat closed the hips down, so the heavy lower-body
      // work goes in while there is still patience for it, then the hip
      // flexors and the cardio, and the shoulders close each round out.
      // Nothing here needs a floor, a wall or more than a parking space.
      exerciseIds: [
        EX.airSquat,
        EX.reverseLunge,
        EX.kneeLift,
        EX.runInPlace,
        EX.armCircles,
        EX.airBoxing,
      ],
      // No rest: fifteen seconds a station is short enough to run straight
      // through, and the station change is the breather.
      interval: { work: 15, rest: 0, rounds: 3 },
      music: {
        bpm: 140,
        style:
          "motorik krautrock, hypnotic driving rhythm, analog synth, no vocals",
        theme:
          "Four and a half minutes at a roadside stop, no pauses — shake the highway out of the legs and get back on the road",
      },
    },
    {
      id: "tpl-dk-grund",
      name: "Grundtræning",
      branch: "Forsvaret",
      description:
        "Basic soldier conditioning circuit, inspired by Træn med " +
        "Forsvaret. Push-ups, air squats, sit-ups, burpees, run on the spot.",
      // The scheme states what the interval enforces, not a prescription
      // the player cannot run: a 400 m station in 40 s is world-record
      // pace, and an interval WOD logs seconds, never metres, so the
      // distance could not have been recorded either. Forty seconds of
      // running with no room to leave is running on the spot.
      scheme: "3 rounds · 5 stations · 40 s work / 20 s rest",
      level: "beginner",
      exerciseIds: [EX.pushUp, EX.airSquat, EX.sitUp, EX.burpee, EX.runInPlace],
      interval: { work: 40, rest: 20, rounds: 3 },
      music: {
        bpm: 155,
        style: "nordic electronic rock, driving drums, cold synths",
        theme: "Danish soldier basic training — disciplined, no-nonsense grind",
      },
    },
    {
      id: "tpl-dk-march",
      name: "Feltmarch",
      branch: "Forsvaret",
      description: "March training under load, inspired by Træn med Forsvaret.",
      scheme: "10 km march · 10 kg pack · steady pace",
      level: "intermediate",
      estimateMinutes: 110,
      exerciseIds: [EX.ruck],
      music: {
        bpm: 120,
        style: "marching drums, nordic folk undertones, hypnotic low drone",
        theme: "Field march across Danish terrain — endless steady kilometres",
      },
    },
    {
      id: "tpl-dk-kredsloeb",
      name: "Kredsløbstræning",
      branch: "Forsvaret",
      description:
        "Cardio circuit intervals, inspired by Træn med Forsvaret. Run on " +
        "the spot, kettlebell swings, burpees.",
      // Same correction as Grundtræning: 800 m in a 60 s station was not a
      // prescription anyone could follow, and the station is timed anyway.
      scheme: "5 rounds · 3 stations · 60 s work / 20 s rest",
      level: "intermediate",
      exerciseIds: [EX.runInPlace, EX.kettlebellSwing, EX.burpee],
      interval: { work: 60, rest: 20, rounds: 5 },
      music: {
        bpm: 165,
        style: "high-energy drum and bass, relentless breakbeats",
        theme: "Circuit intervals — heart pounding, quick transitions",
      },
    },
    {
      id: "tpl-murph",
      name: "Murph",
      branch: "CrossFit Hero WOD",
      description:
        "In memory of Lt. Michael Murphy. Traditionally done wearing a 9 kg vest.",
      scheme:
        "1.6 km run · 100 pull-ups · 200 push-ups · 300 air squats · 1.6 km run — for time",
      level: "advanced",
      estimateMinutes: 60,
      exerciseIds: [EX.run, EX.pullUp, EX.pushUp, EX.airSquat, EX.run],
      // The middle 600 reps are one stage each, exactly as prescribed —
      // partition them however you like, the clock only cares when the
      // last squat is done.
      forTime: {
        stages: [
          { exerciseId: EX.run, label: "1.6 km run", meters: 1600 },
          { exerciseId: EX.pullUp, label: "100 pull-ups", reps: 100 },
          { exerciseId: EX.pushUp, label: "200 push-ups", reps: 200 },
          { exerciseId: EX.airSquat, label: "300 air squats", reps: 300 },
          { exerciseId: EX.run, label: "1.6 km run", meters: 1600 },
        ],
      },
      music: {
        bpm: 175,
        style: "aggressive electronic rock, pounding drums, distorted guitar",
        theme: "Relentless hero tribute — pain, honor, pushing past the limit",
      },
    },
    {
      id: "tpl-acft",
      name: "ACFT (Army Combat Fitness Test)",
      branch: "U.S. Army",
      description:
        "Six-event test of combat readiness. Log each event's score.",
      // Six events named, six cards logged. The power throw and the
      // sprint-drag-carry had no exercise anywhere in the repo, so the
      // session showed four cards under a note promising six; they are
      // seeded rather than dropped from the text, because a service test
      // you can only log two thirds of is not the test. (The 2025 Army
      // Fitness Test retires the power throw — this template is the ACFT.)
      scheme:
        "3-rep deadlift · power throw · hand-release push-ups · sprint-drag-carry · plank · 3.2 km run",
      level: "advanced",
      estimateMinutes: 50,
      exerciseIds: [
        EX.deadlift,
        EX.powerThrow,
        EX.pushUp,
        EX.sprintDragCarry,
        EX.plank,
        EX.run,
      ],
      music: {
        bpm: 160,
        style: "hard military trap, heavy 808s, snare cadence",
        theme: "Combat readiness test — focused aggression under pressure",
      },
    },
    {
      id: "tpl-usmc-pft",
      name: "USMC PFT",
      branch: "U.S. Marine Corps",
      description: "Physical Fitness Test — max effort on each event.",
      scheme: "Pull-ups (max) · plank (max hold) · 4.8 km run (for time)",
      level: "intermediate",
      estimateMinutes: 35,
      exerciseIds: [EX.pullUp, EX.plank, EX.run],
      music: {
        bpm: 165,
        style: "hard rock, driving double-time drums",
        theme: "Max effort test day — no slack, all out",
      },
    },
    {
      id: "tpl-navy-prt",
      name: "Navy PRT",
      branch: "U.S. Navy",
      description: "Physical Readiness Test.",
      scheme: "Forearm plank (max) · push-ups 2:00 · 2.4 km run",
      level: "intermediate",
      estimateMinutes: 25,
      exerciseIds: [EX.plank, EX.pushUp, EX.run],
      music: {
        bpm: 150,
        style: "electronic rock, steady pulse",
        theme: "Disciplined readiness — steady grind to the finish",
      },
    },
    {
      id: "tpl-cindy",
      name: "Cindy",
      branch: "CrossFit Benchmark",
      description:
        "Cindy is a 20-minute AMRAP — 5 pull-ups, 10 push-ups, 15 air " +
        "squats, as many rounds as possible. The guided player counts the " +
        "clock, not rounds, so this is the timed adaptation.",
      // Twenty minutes of continuous work at a fixed station pace. Rest is
      // zero because an AMRAP has none: the old 30/10 × 10 injected 290 s
      // of rest into the one format defined by not having any, and traded
      // the score for a fixed round count. Count your own rounds for the
      // real Cindy.
      scheme: "Timed adaptation · 10 rounds · 3 stations · 40 s work, no rest",
      level: "advanced",
      exerciseIds: [EX.pullUp, EX.pushUp, EX.airSquat],
      interval: { work: 40, rest: 0, rounds: 10 },
      music: {
        bpm: 170,
        style: "fast punk rock, upbeat and raw",
        theme: "Twenty minutes of relentless rounds — keep moving",
      },
    },
    {
      id: "tpl-ruck-standard",
      name: "Standard Ruck",
      branch: "Army Ranger / SF",
      description: "Foot-march standard: 19.3 km with a 16 kg dry pack.",
      scheme: "19.3 km ruck · 16 kg load · target sub-3:00 — for time",
      level: "advanced",
      estimateMinutes: 180,
      exerciseIds: [EX.ruck],
      // One stage on the stopwatch. With GPS on, the distance is measured
      // with the phone in a pocket and the stage completes at 19.3 km.
      forTime: {
        stages: [{ exerciseId: EX.ruck, label: "19.3 km ruck", meters: 19300 }],
      },
      music: {
        bpm: 130,
        style: "dark folk percussion, marching cadence, low drone",
        theme: "Long ruck under load — one step after another for hours",
      },
    },
    {
      id: "tpl-dt",
      name: "DT",
      branch: "CrossFit Hero WOD",
      description: "In memory of USAF SSgt Timothy Davis.",
      scheme:
        "5 rounds: 12 deadlifts · 9 hang power cleans · 6 push press @ 70/48 kg — for time",
      level: "advanced",
      estimateMinutes: 15,
      exerciseIds: [EX.deadlift, EX.hangPowerClean, EX.pushPress],
      // Five rounds of three movements: fifteen stages, round number in
      // each label so the athlete always knows where they are.
      forTime: {
        stages: [1, 2, 3, 4, 5].flatMap((r) => [
          { exerciseId: EX.deadlift, label: `Round ${String(r)} · 12 deadlifts`, reps: 12 },
          { exerciseId: EX.hangPowerClean, label: `Round ${String(r)} · 9 hang power cleans`, reps: 9 },
          { exerciseId: EX.pushPress, label: `Round ${String(r)} · 6 push press`, reps: 6 },
        ]),
      },
      music: {
        bpm: 172,
        style: "heavy metal, barbell-slamming riffs",
        theme: "Five brutal barbell rounds in tribute — heavy and fast",
      },
    },
    {
      id: "tpl-varg-mobility-5",
      name: "Varg Mobility 5",
      branch: "Varg",
      description:
        "Daily mobility, short form. Six stations through ankles, hips, " +
        "spine and shoulders, straight through with no rest — the station " +
        "change is the breather. Floor work included; do it every day, not " +
        "just leg day.",
      scheme: "1 round · 6 stations · 50 s work, no rest — 5 min flow",
      level: "beginner",
      // Ankles, then shoulders, then onto the floor for spine, hip and a
      // combined hip-and-spine rotation, closing on a flow that opens
      // shoulders, spine and ankles together. The 20-minute version below
      // uses the same order plus the two static holds this one drops to
      // stay moving.
      exerciseIds: [
        EX.ankleRock,
        EX.armCircles,
        EX.catCow,
        EX.hip90Switch,
        EX.worldsGreatestStretch,
        EX.downDogCobra,
      ],
      interval: { work: 50, rest: 0, rounds: 1 },
      music: {
        bpm: 90,
        style: "calm ambient, soft pads, minimal percussion, no vocals",
        theme:
          "Five minutes to unlock stiff joints before the day starts — unhurried, deliberate breath",
      },
    },
    {
      id: "tpl-varg-mobility-20",
      name: "Varg Mobility 20",
      branch: "Varg",
      description:
        "Daily mobility, full form. Eight stations through ankles, hips, " +
        "spine and shoulders across three rounds, straight through with no " +
        "rest. Floor work included — the long version for a rest day or a " +
        "stiff morning.",
      scheme: "3 rounds · 8 stations · 50 s work, no rest — 20 min flow",
      level: "beginner",
      exerciseIds: [
        EX.ankleRock,
        EX.armCircles,
        EX.catCow,
        EX.hip90Switch,
        EX.worldsGreatestStretch,
        EX.hipFlexorStretch,
        EX.openBook,
        EX.downDogCobra,
      ],
      interval: { work: 50, rest: 0, rounds: 3 },
      music: {
        bpm: 80,
        style:
          "spacious ambient drone, slow evolving textures, gentle rhythmic pulse, no vocals",
        theme:
          "Twenty minutes moving through hips, spine, shoulders and ankles — patient, full range, a wolf stretching out before the hunt",
      },
    },
    {
      id: "tpl-chad",
      name: "Chad 1000x",
      branch: "Navy SEAL",
      description:
        "1,000 box step-ups with a rucksack. Honors LT Chad Wilkinson.",
      scheme: "1000 step-ups @ 50 cm box · 20/16 kg ruck — for time",
      level: "advanced",
      estimateMinutes: 75,
      // Step-ups, not box jumps. The station used to map to Box Jump,
      // whose cues say "explode up, land soft" — a thousand jumps under a
      // ruck is a different, and much worse, workout — and it filed the
      // reps as a Box Jump record.
      exerciseIds: [EX.boxStepUp, EX.ruck],
      // One stage: the thousand step-ups. The ruck is the load worn
      // throughout, not a leg of its own.
      forTime: {
        stages: [
          { exerciseId: EX.boxStepUp, label: "1000 box step-ups", reps: 1000 },
        ],
      },
      music: {
        bpm: 135,
        style: "somber cinematic percussion, steady stomping beat",
        theme: "A thousand step-ups in remembrance — solemn, unbroken rhythm",
      },
    },
  ];
}
