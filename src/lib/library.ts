/**
 * Exercise library content: which animation demonstrates each built-in
 * exercise, plus concise form cues. Custom exercises fall back to an
 * archetype for their category.
 */
import type { AnimKey } from "../components/ExerciseAnim";
import type { Category, Exercise } from "../types";
import { EX } from "./seed";

interface LibraryEntry {
  anim: AnimKey;
  cues: string[];
}

const LIB: Record<string, LibraryEntry> = {
  [EX.backSquat]: {
    anim: "squat",
    cues: [
      "Bar on upper traps, brace hard before descending.",
      "Sit down between the hips, knees tracking over toes.",
      "Hit at least parallel, drive up through mid-foot.",
    ],
  },
  [EX.frontSquat]: {
    anim: "squat",
    cues: [
      "Bar racked on front delts, elbows high.",
      "Torso as upright as possible all the way down.",
      "Lead the ascent with the elbows, not the hips.",
    ],
  },
  [EX.deadlift]: {
    anim: "hinge",
    cues: [
      "Bar over mid-foot, shins touching, back flat.",
      "Wedge in: chest up, lats tight, slack out of the bar.",
      "Push the floor away; lock out hips and knees together.",
    ],
  },
  [EX.benchPress]: {
    anim: "bench",
    cues: [
      "Shoulder blades pinched, feet planted.",
      "Bar to lower chest with elbows ~45°.",
      "Press back up toward the eyes; full lockout.",
    ],
  },
  [EX.overheadPress]: {
    anim: "press",
    cues: [
      "Squeeze glutes, ribs down — no leaning back.",
      "Press slightly around the face, then straight up.",
      "Finish with biceps by the ears, bar over mid-foot.",
    ],
  },
  [EX.barbellRow]: {
    anim: "row",
    cues: [
      "Hinge to ~45°, flat back, bar under the shoulders.",
      "Pull to the lower ribs, elbows tight.",
      "Lower under control — no torso heave.",
    ],
  },
  [EX.powerClean]: {
    anim: "hinge",
    cues: [
      "Set up like a deadlift, shoulders over the bar.",
      "Explode with the hips, shrug, pull under.",
      "Catch on the front delts with elbows through.",
    ],
  },
  [EX.thruster]: {
    anim: "thruster",
    cues: [
      "Front squat to full depth.",
      "Drive out of the hole and press in one motion.",
      "Exhale at lockout, breathe on the way down.",
    ],
  },
  [EX.kettlebellSwing]: {
    anim: "swing",
    cues: [
      "Hinge, don't squat — bell high between the thighs.",
      "Snap the hips; arms are just ropes.",
      "Chest-height float, then let it fall into the next rep.",
    ],
  },
  [EX.wallBall]: {
    anim: "thruster",
    cues: [
      "Full squat holding the ball at the chest.",
      "Drive up and throw to the target in one rhythm.",
      "Absorb the catch straight into the next squat.",
    ],
  },
  [EX.farmerCarry]: {
    anim: "carry",
    cues: [
      "Deadlift the handles up — never round over.",
      "Tall posture, ribs stacked, crush grip.",
      "Short fast steps; stop before your grip fails.",
    ],
  },
  [EX.airSquat]: {
    anim: "airSquat",
    cues: [
      "Feet shoulder width, weight through the whole foot.",
      "Hips back and down past parallel, chest tall.",
      "Arms out front for balance; stand fully at the top.",
    ],
  },
  [EX.pullUp]: {
    anim: "pullup",
    cues: [
      "Dead hang, overhand grip just outside shoulders.",
      "Pull the elbows to the ribs, chin over the bar.",
      "Full extension at the bottom of every rep.",
    ],
  },
  [EX.chinUp]: {
    anim: "pullup",
    cues: [
      "Underhand grip, shoulder width.",
      "Chest to the bar, squeeze biceps and lats.",
      "Control the negative — no dropping.",
    ],
  },
  [EX.pushUp]: {
    anim: "pushup",
    cues: [
      "Rigid plank from head to heels.",
      "Chest to the deck, elbows ~45° from the body.",
      "Lock out fully — every rep, same rep.",
    ],
  },
  [EX.dip]: {
    anim: "dip",
    cues: [
      "Support hold, shoulders down and back.",
      "Lower until upper arms hit parallel.",
      "Press to lockout without swinging.",
    ],
  },
  [EX.benchDip]: {
    anim: "benchDip",
    cues: [
      "Hands on the bench edge behind you, fingers forward.",
      "Elbows straight back, lower until upper arms are parallel.",
      "Press up through the heels of the hands — shoulders down, not shrugged.",
    ],
  },
  [EX.sitUp]: {
    anim: "situp",
    cues: [
      "Knees bent, feet anchored or free.",
      "Curl the trunk — chest to knees.",
      "Lower with control; no neck pulling.",
    ],
  },
  [EX.backLift]: {
    anim: "backLift",
    cues: [
      "Face down, arms reaching forward, forehead near the deck.",
      "Lift chest, arms and legs together — squeeze the glutes.",
      "Look at the floor, never crank the neck back. Lower slow.",
    ],
  },
  [EX.flutterKick]: {
    anim: "flutter",
    cues: [
      "Lower back pressed into the deck.",
      "Legs straight, heels 15 cm off the ground.",
      "Small fast alternating kicks; keep breathing.",
    ],
  },
  [EX.hangingLegRaise]: {
    anim: "hang",
    cues: [
      "Dead hang, shoulders packed.",
      "Raise straight legs to at least parallel.",
      "No swing — control down, control up.",
    ],
  },
  [EX.lunge]: {
    anim: "lunge",
    cues: [
      "Long step, torso tall.",
      "Back knee kisses the ground.",
      "Drive through the front heel into the next step.",
    ],
  },
  [EX.burpee]: {
    anim: "burpee",
    cues: [
      "Hands down, kick back to a plank.",
      "Chest to the deck.",
      "Snap the feet in, jump and clap overhead.",
    ],
  },
  [EX.boxJump]: {
    anim: "jump",
    cues: [
      "Load the hips, arms back.",
      "Explode up, land soft and quiet — full foot on the box.",
      "Stand tall on top; step down, don't rebound.",
    ],
  },
  [EX.plank]: {
    anim: "plank",
    cues: [
      "Elbows under shoulders, feet together.",
      "Squeeze glutes and quads — one straight line.",
      "Breathe shallow and steady; no sagging hips.",
    ],
  },
  [EX.run]: {
    anim: "run",
    cues: [
      "Tall posture, slight forward lean.",
      "Quick cadence (~180 steps/min), land under the hips.",
      "Relax shoulders and hands.",
    ],
  },
  [EX.runInPlace]: {
    anim: "runInPlace",
    cues: [
      "Knees to hip height, land on the balls of the feet.",
      "Quick light cadence — noise means you're stamping.",
      "Arms driving, shoulders loose, torso upright.",
    ],
  },
  [EX.airBoxing]: {
    anim: "boxing",
    cues: [
      "Hands up by the cheeks, chin tucked, elbows in.",
      "Punch straight from the guard and snap it back — don't wind up.",
      "Rotate hip and shoulder into every shot; keep the feet moving.",
    ],
  },
  [EX.ruck]: {
    anim: "ruck",
    cues: [
      "Pack high and tight against the back.",
      "Aggressive walking pace — stride out, don't jog it all.",
      "Care for the feet: socks, lacing, tape hot spots early.",
    ],
  },
  [EX.row]: {
    anim: "rowErg",
    cues: [
      "Sequence: legs → back → arms; reverse on the return.",
      "Drive with the legs, arms straight until the finish.",
      "Handle to lower ribs, controlled recovery.",
    ],
  },
  [EX.assaultBike]: {
    anim: "bike",
    cues: [
      "Push AND pull the handles; drive with the legs.",
      "Stay seated tall, core braced.",
      "Settle into a pace you can repeat — it lies to you early.",
    ],
  },
};

const CATEGORY_FALLBACK: Record<Category, LibraryEntry> = {
  strength: {
    anim: "hinge",
    cues: ["Brace before every rep.", "Full range of motion.", "Own the eccentric."],
  },
  bodyweight: {
    anim: "pushup",
    cues: ["Strict form before reps.", "Full lockout, full stretch.", "Quality over quantity."],
  },
  core: {
    anim: "plank",
    cues: ["Brace the trunk.", "Move slow, no momentum.", "Keep breathing."],
  },
  conditioning: {
    anim: "burpee",
    cues: ["Set a repeatable pace.", "Break before you fail.", "Fast transitions."],
  },
  cardio: {
    anim: "run",
    cues: ["Even pacing.", "Nasal breathing at easy pace.", "Finish strong."],
  },
  ruck: {
    anim: "ruck",
    cues: ["Load tight to the back.", "Stride out.", "Protect the feet."],
  },
};

export function libraryFor(ex: Exercise): LibraryEntry {
  return LIB[ex.id] ?? CATEGORY_FALLBACK[ex.category];
}

/**
 * Does this exercise have its own animation and cues, rather than the
 * category archetype? Built-ins must — a fallback demonstrates the wrong
 * movement. `bun run db:smoke` asserts full coverage.
 */
export function hasLibraryEntry(exerciseId: string): boolean {
  return exerciseId in LIB;
}
