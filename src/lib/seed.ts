/**
 * Built-in content: every exercise, split and workout program the app ships.
 *
 * THIS FILE IS THE PROGRAM LIBRARY, AND IT IS EDITED BY HAND.
 *
 * Varg deliberately has no in-app program authoring. When the owner wants a
 * new workout they describe it in prose and an agent adds it here, then ships
 * a build. That is the intended workflow — not a gap waiting for a template
 * editor screen. (The ad-hoc "Interval WOD" sheet on the Hunt screen is a
 * scratchpad for throwing a circuit together on the spot; it does not persist
 * and it is not a program library.)
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
    e(EX.farmerCarryDistance, "Farmer's Carry", "conditioning", "distance_time", ["grip", "core"]),
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
    e(EX.reverseLunge, "Reverse Lunge", "bodyweight", "reps", ["quads", "glutes", "hip flexors"]),
    e(EX.kneeLift, "Standing Knee Lift", "bodyweight", "reps", ["hip flexors", "core"]),
    e(EX.armCircles, "Arm Circles", "bodyweight", "time", ["shoulders", "upper back"]),
    e(EX.burpee, "Burpee", "conditioning", "reps", ["full body"]),
    e(EX.boxJump, "Box Jump", "conditioning", "reps", ["legs"]),
    e(EX.boxStepUp, "Box Step-up", "conditioning", "reps", ["legs", "glutes"]),
    // Both ACFT events are scored on a single effort: metres thrown, and
    // the 250 m shuttle's clock time. They are distance_time and not time
    // because a "time" PR is a maximum (prs.ts) — for a for-time event
    // that would record the athlete's worst run as their record.
    e(EX.powerThrow, "Standing Power Throw", "conditioning", "distance_time", ["full body"]),
    e(EX.sprintDragCarry, "Sprint-Drag-Carry", "conditioning", "distance_time", ["full body"]),
    e(EX.plank, "Plank", "core", "time", ["core"]),
    e(EX.run, "Run", "cardio", "distance_time", ["conditioning"]),
    e(EX.runInPlace, "Run on the Spot", "cardio", "time", ["conditioning"]),
    e(EX.airBoxing, "Air Boxing", "cardio", "time", ["conditioning", "shoulders"]),
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
        { id: "pt-ruck", name: "Ruck Day", exerciseIds: [EX.ruck, EX.farmerCarryDistance, EX.plank] },
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
      id: "tpl-rasteplads",
      name: "Rasteplads",
      branch: "Varg",
      description:
        "Rest-stop reset after one to two hours behind the wheel. Standing " +
        "only — nothing goes on the tarmac. Opens the hips the seat closed " +
        "down, unlocks the shoulders, moves blood without soaking your shirt " +
        "for the next leg.",
      // No round length here either. Rounds 1 and 2 are 3:00, but the player
      // drops the trailing rest so round 3 is 2:50 — and the card already
      // shows the real total. See the note on tpl-varg-18.
      scheme: "3 rounds · 6 stations · 20 s work / 10 s rest",
      // Ordered for a body that has just been folded into a car seat: start
      // with the shoulders while everything is still cold, alternate lower
      // and upper, and put the two hip-openers where the legs are warm.
      // Nothing here needs a floor, a wall or more than a parking space.
      exerciseIds: [
        EX.armCircles,
        EX.airSquat,
        EX.runInPlace,
        EX.kneeLift,
        EX.reverseLunge,
        EX.airBoxing,
      ],
      interval: { work: 20, rest: 10, rounds: 3 },
      music: {
        bpm: 140,
        style:
          "motorik krautrock, hypnotic driving rhythm, analog synth, no vocals",
        theme:
          "Nine minutes at a roadside stop — shake the highway out of the legs and get back on the road",
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
      scheme: "1.6 km run · 100 pull-ups · 200 push-ups · 300 air squats · 1.6 km run — for time",
      exerciseIds: [EX.run, EX.pullUp, EX.pushUp, EX.airSquat, EX.run],
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
      description: "Six-event test of combat readiness. Log each event's score.",
      // Six events named, six cards logged. The power throw and the
      // sprint-drag-carry had no exercise anywhere in the repo, so the
      // session showed four cards under a note promising six; they are
      // seeded rather than dropped from the text, because a service test
      // you can only log two thirds of is not the test. (The 2025 Army
      // Fitness Test retires the power throw — this template is the ACFT.)
      scheme: "3-rep deadlift · power throw · hand-release push-ups · sprint-drag-carry · plank · 3.2 km run",
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
      scheme: "19.3 km ruck · 16 kg load · target sub-3:00",
      exerciseIds: [EX.ruck],
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
      scheme: "5 rounds: 12 deadlifts · 9 hang power cleans · 6 push press @ 70/48 kg — for time",
      exerciseIds: [EX.deadlift, EX.powerClean, EX.overheadPress],
      music: {
        bpm: 172,
        style: "heavy metal, barbell-slamming riffs",
        theme: "Five brutal barbell rounds in tribute — heavy and fast",
      },
    },
    {
      id: "tpl-chad",
      name: "Chad 1000x",
      branch: "Navy SEAL",
      description: "1,000 box step-ups with a rucksack. Honors LT Chad Wilkinson.",
      scheme: "1000 step-ups @ 50 cm box · 20/16 kg ruck — for time",
      // Step-ups, not box jumps. The station used to map to Box Jump,
      // whose cues say "explode up, land soft" — a thousand jumps under a
      // ruck is a different, and much worse, workout — and it filed the
      // reps as a Box Jump record.
      exerciseIds: [EX.boxStepUp, EX.ruck],
      music: {
        bpm: 135,
        style: "somber cinematic percussion, steady stomping beat",
        theme: "A thousand step-ups in remembrance — solemn, unbroken rhythm",
      },
    },
  ];
}
